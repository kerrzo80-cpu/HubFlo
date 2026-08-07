"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, SendHorizontal, SkipForward, Volume2 } from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/field/BlakeCharacter";
import type { HubRole } from "@/lib/access";
import type {
  TrainerCitation,
  TrainerFlow,
  TrainerModule,
  TrainerProgress,
  TrainerStep,
  TrainerTurnResponse,
} from "@/lib/blake-trainer/types";
import {
  ensureMicAccess,
  speakBlakeReply,
  speechSupported,
  startMicLevelMonitor,
  startVoiceRecorder,
  stopBlakeAudio,
  stopMicStream,
  transcribeBlakeAudio,
  unlockBlakeVoice,
  type ActiveVoiceRecorder,
  type MicLevelMonitor,
  type VoiceSessionState,
} from "@/lib/field/ask-blake-voice";
import { TrainChrome } from "./TrainChrome";

type CatalogResponse = {
  ok: boolean;
  role: HubRole;
  userId: string;
  flows: TrainerFlow[];
  progress: TrainerProgress[];
};

type Bubble = {
  role: "blake" | "user";
  text: string;
  citations?: TrainerCitation[];
};

const ROLE_OPTIONS: HubRole[] = [
  "Engineer",
  "Office",
  "Manager",
  "Owner/Admin",
  "Finance",
  "Read-only",
];

/** Continuous conversation: end your turn when you pause after speaking. */
const SPEECH_LEVEL = 0.11;
const SILENCE_MS = 1300;
const MIN_SPEECH_MS = 350;
const MAX_LISTEN_MS = 28_000;
const POST_SPEAK_GAP_MS = 480;

function moodForState(state: VoiceSessionState, phase?: string): BlakeMood {
  if (state === "thinking") return "thinking";
  if (state === "listening") return "alert";
  if (state === "speaking") return "guide";
  if (phase === "complete") return "good";
  return "guide";
}

function progressPercent(progress?: TrainerProgress | null) {
  if (!progress) return 0;
  const steps = progress.modules.flatMap((mod) => mod.steps);
  if (!steps.length) return 0;
  const done = steps.filter((step) => step.completed).length;
  return Math.round((done / steps.length) * 100);
}

function turnModeForUtterance(step: TrainerStep | null | undefined, trimmed: string) {
  if (step?.kind === "check") return "check_answer" as const;
  if (/^(next|continue|done|ok|okay|ready|got it)\b/i.test(trimmed)) return "continue" as const;
  return "question" as const;
}

export function TrainHomeClient() {
  const [role, setRole] = useState<HubRole>("Engineer");
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState("");
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [soundReady, setSoundReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/blake-trainer?role=${encodeURIComponent(role)}`, {
          credentials: "same-origin",
        });
        const data = (await response.json()) as CatalogResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load training.");
        if (!cancelled) setCatalog(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [role]);

  async function beginFlow(flowId: string) {
    try {
      // Must run in the tap handler — browsers block Blake’s voice otherwise.
      await unlockBlakeVoice();
      setSoundReady(true);
    } catch {
      setSoundReady(false);
    }
    setActiveFlowId(flowId);
  }

  if (activeFlowId) {
    return (
      <TrainSession
        flowId={activeFlowId}
        role={role}
        userId={catalog?.userId || "demo-learner"}
        soundReady={soundReady}
        onExit={() => setActiveFlowId(null)}
      />
    );
  }

  return (
    <TrainChrome subtitle="Role-aware modules · approved materials only">
      <section className="blake-train-hero">
        <div>
          <h1>Blake trains your team by voice</h1>
          <p>
            Blake talks staff through each module in a continuous conversation — you speak, Blake
            replies, back and forth. Answers stay grounded only in approved NeXa guides, screenshots,
            videos, FAQs and company rules.
          </p>
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: "0.86rem", fontWeight: 650 }}>
              Train as{" "}
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as HubRole)}
                style={{ marginLeft: 8, borderRadius: 10, border: "1px solid #d9dee5", padding: "8px 10px" }}
              >
                {ROLE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="blake-train-hero-visual">
          <BlakeCharacter mood="guide" size="hero" />
        </div>
      </section>

      {error ? <div className="blake-train-error">{error}</div> : null}
      {loading ? <p style={{ color: "#5d6673" }}>Loading flows for {role}…</p> : null}

      <div className="blake-train-grid">
        {(catalog?.flows || []).map((flow) => {
          const existing = catalog?.progress.find((item) => item.flowId === flow.id);
          const pct = progressPercent(existing);
          return (
            <article key={flow.id} className="blake-train-flow">
              <h2>{flow.title}</h2>
              <p>{flow.description}</p>
              <div className="blake-train-meta">
                <span>{flow.moduleIds.length} modules</span>
                {existing ? <span>{pct}% complete</span> : <span>Not started</span>}
                {flow.roles.slice(0, 3).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <button type="button" className="blake-train-btn verdigris" onClick={() => void beginFlow(flow.id)}>
                {existing?.status === "completed" ? "Review with Blake" : existing ? "Continue with Blake" : "Start with Blake"}
              </button>
            </article>
          );
        })}
      </div>

      {!loading && catalog && !catalog.flows.length ? (
        <p style={{ color: "#5d6673", marginTop: 18 }}>
          No published flows for {role} yet. Admins can create them in Train → Admin.
        </p>
      ) : null}
    </TrainChrome>
  );
}

function TrainSession({
  flowId,
  role,
  userId,
  soundReady: soundReadyProp,
  onExit,
}: {
  flowId: string;
  role: HubRole;
  userId: string;
  soundReady: boolean;
  onExit: () => void;
}) {
  const [supported, setSupported] = useState(true);
  const [voiceState, setVoiceState] = useState<VoiceSessionState>("idle");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<TrainerProgress | null>(null);
  const [flow, setFlow] = useState<TrainerFlow | null>(null);
  const [module, setModule] = useState<TrainerModule | null>(null);
  const [step, setStep] = useState<TrainerStep | null>(null);
  const [phase, setPhase] = useState<string>("intro");
  const [openaiOk, setOpenaiOk] = useState<boolean | null>(null);
  const [level, setLevel] = useState(0);
  const [soundReady, setSoundReady] = useState(soundReadyProp);
  const [pendingSpeak, setPendingSpeak] = useState("");
  const [conversationOn, setConversationOn] = useState(true);

  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ActiveVoiceRecorder | null>(null);
  const levelMonitorRef = useRef<MicLevelMonitor | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const startedRef = useRef(false);
  const conversationOnRef = useRef(true);
  const phaseRef = useRef(phase);
  const stepRef = useRef(step);
  const listenWatchRef = useRef<number | null>(null);
  const autoListenTimerRef = useRef<number | null>(null);
  const listenStartedAtRef = useRef(0);
  const speechStartedAtRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const heardSpeechRef = useRef(false);
  const finishingListenRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    conversationOnRef.current = conversationOn;
  }, [conversationOn]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    setSupported(speechSupported());
    void fetch("/api/field/ask-blake", { credentials: "same-origin" })
      .then((res) => res.json())
      .then((data: { connected?: boolean }) => setOpenaiOk(Boolean(data.connected)))
      .catch(() => setOpenaiOk(false));

    if (!startedRef.current) {
      startedRef.current = true;
      void sendTurn("start");
    }
    return () => {
      mountedRef.current = false;
      void hardStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [bubbles, voiceState]);

  function clearListenWatch() {
    if (listenWatchRef.current != null) {
      window.clearInterval(listenWatchRef.current);
      listenWatchRef.current = null;
    }
  }

  function clearAutoListenTimer() {
    if (autoListenTimerRef.current != null) {
      window.clearTimeout(autoListenTimerRef.current);
      autoListenTimerRef.current = null;
    }
  }

  function stopLevelMonitor() {
    levelMonitorRef.current?.stop();
    levelMonitorRef.current = null;
    setLevel(0);
  }

  async function hardStop() {
    clearAutoListenTimer();
    clearListenWatch();
    conversationOnRef.current = false;
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    stopLevelMonitor();
    stopBlakeAudio();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      try {
        await recorder.stop();
      } catch {
        // ignore
      }
    }
    stopMicStream(micStreamRef.current);
    micStreamRef.current = null;
  }

  function applyTurn(result: TrainerTurnResponse, userText?: string) {
    setProgress(result.progress);
    setFlow(result.flow);
    setModule(result.module ?? null);
    setStep(result.step ?? null);
    setPhase(result.phase);
    setBubbles((current) => {
      const next = [...current];
      if (userText) next.push({ role: "user", text: userText });
      next.push({
        role: "blake",
        text: result.reply,
        citations: result.citations,
      });
      return next;
    });
  }

  function scheduleAutoListen() {
    clearAutoListenTimer();
    if (!mountedRef.current) return;
    if (!conversationOnRef.current || !supported) {
      setVoiceState("idle");
      return;
    }
    if (phaseRef.current === "complete") {
      setVoiceState("idle");
      return;
    }
    setVoiceState("idle");
    autoListenTimerRef.current = window.setTimeout(() => {
      autoListenTimerRef.current = null;
      if (!mountedRef.current || !conversationOnRef.current || busyRef.current) return;
      if (phaseRef.current === "complete") return;
      void startListening();
    }, POST_SPEAK_GAP_MS);
  }

  async function speak(text: string, opts?: { afterSpeak?: "listen" | "idle" }) {
    const spoken = text.trim();
    if (!spoken) return;
    clearAutoListenTimer();
    stopSpeakRef.current?.();
    setPendingSpeak(spoken);
    setVoiceState("speaking");
    setError("");
    const after = opts?.afterSpeak ?? "listen";
    try {
      // Do not call stopBlakeAudio here — it can tear down the iPhone unlock.
      stopSpeakRef.current = await speakBlakeReply(spoken, {
        speakPath: "/api/blake-trainer/speak",
        preferServer: false,
        onEnd: () => {
          stopSpeakRef.current = null;
          if (after === "listen") scheduleAutoListen();
          else setVoiceState("idle");
        },
      });
    } catch {
      setVoiceState("idle");
      setSoundReady(false);
      setError("No sound yet — tap Enable sound (keep the screen on).");
    }
  }

  async function enableSoundAndReplay() {
    setError("");
    clearAutoListenTimer();
    setVoiceState("speaking");
    try {
      await unlockBlakeVoice();
      setSoundReady(true);
      const lastBlake = [...bubbles].reverse().find((item) => item.role === "blake")?.text || pendingSpeak;
      if (!lastBlake) {
        setVoiceState("idle");
        setError("Nothing to play yet — start a module first.");
        return;
      }
      stopSpeakRef.current?.();
      stopSpeakRef.current = await speakBlakeReply(lastBlake, {
        speakPath: "/api/blake-trainer/speak",
        preferServer: false,
        onEnd: () => {
          stopSpeakRef.current = null;
          scheduleAutoListen();
        },
      });
    } catch (err) {
      setVoiceState("idle");
      setSoundReady(false);
      setError(
        err instanceof Error
          ? `Still no audio (${err.message}). Check OpenAI voice in Setup, then tap Enable sound again.`
          : "Still no audio — check OpenAI voice in Setup, then tap Enable sound again.",
      );
    }
  }

  async function sendTurn(
    mode: "start" | "continue" | "question" | "check_answer",
    message?: string,
    opts?: { voice?: boolean },
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError("");
    setVoiceState("thinking");
    try {
      const response = await fetch("/api/blake-trainer/turn", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowId,
          progressId: progress?.id,
          userId,
          userName: role === "Owner/Admin" ? "Brian Kerr" : "Learner",
          role,
          mode,
          message,
          voice: opts?.voice ?? true,
        }),
      });
      const data = (await response.json()) as TrainerTurnResponse & { error?: string; ok?: boolean };
      if (!response.ok) throw new Error(data.error || "Blake could not reply.");
      applyTurn(data, mode === "start" ? undefined : message);
      await speak(data.reply, { afterSpeak: "listen" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Turn failed.");
      setVoiceState("error");
      if (conversationOnRef.current && phaseRef.current !== "complete") {
        scheduleAutoListen();
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function ensureOpenMic() {
    if (micStreamRef.current?.getTracks().some((track) => track.readyState === "live")) {
      return micStreamRef.current;
    }
    const stream = await ensureMicAccess();
    micStreamRef.current = stream;
    return stream;
  }

  async function discardActiveRecorder() {
    clearListenWatch();
    stopLevelMonitor();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      try {
        await recorder.stop();
      } catch {
        // ignore
      }
    }
    finishingListenRef.current = false;
  }

  async function startListening() {
    if (!supported || busyRef.current || !conversationOnRef.current) return;
    if (recorderRef.current) return;
    clearAutoListenTimer();
    setError("");
    finishingListenRef.current = false;
    heardSpeechRef.current = false;
    speechStartedAtRef.current = 0;
    lastSpeechAtRef.current = 0;
    listenStartedAtRef.current = Date.now();
    try {
      await unlockBlakeVoice();
      setSoundReady(true);
      const stream = await ensureOpenMic();
      const recorder = startVoiceRecorder(stream);
      recorderRef.current = recorder;
      levelMonitorRef.current = startMicLevelMonitor(stream, (value) => {
        setLevel(value);
        const now = Date.now();
        if (value >= SPEECH_LEVEL) {
          if (!heardSpeechRef.current) {
            heardSpeechRef.current = true;
            speechStartedAtRef.current = now;
          }
          lastSpeechAtRef.current = now;
        }
      });
      clearListenWatch();
      listenWatchRef.current = window.setInterval(() => {
        if (finishingListenRef.current || !conversationOnRef.current) return;
        const now = Date.now();
        const elapsed = now - listenStartedAtRef.current;
        if (elapsed >= MAX_LISTEN_MS) {
          void finishListening({ emptyRetry: !heardSpeechRef.current });
          return;
        }
        if (
          heardSpeechRef.current
          && speechStartedAtRef.current > 0
          && now - speechStartedAtRef.current >= MIN_SPEECH_MS
          && now - lastSpeechAtRef.current >= SILENCE_MS
        ) {
          void finishListening();
        }
      }, 120);
      setVoiceState("listening");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone blocked.");
      setVoiceState("error");
      setConversationOn(false);
      conversationOnRef.current = false;
    }
  }

  async function finishListening(opts?: { emptyRetry?: boolean }) {
    if (finishingListenRef.current) return;
    finishingListenRef.current = true;
    clearListenWatch();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    stopLevelMonitor();
    if (!recorder) {
      finishingListenRef.current = false;
      if (conversationOnRef.current && phaseRef.current !== "complete") scheduleAutoListen();
      else setVoiceState("idle");
      return;
    }
    setVoiceState("thinking");
    try {
      const blob = await recorder.stop();
      if (!blob || blob.size < 200 || opts?.emptyRetry || !heardSpeechRef.current) {
        finishingListenRef.current = false;
        if (conversationOnRef.current && phaseRef.current !== "complete") {
          setError("");
          scheduleAutoListen();
        } else {
          setVoiceState("idle");
        }
        return;
      }
      if (openaiOk === false) {
        setError("Voice transcription needs OpenAI connected (Setup / Connect). You can still type.");
        setVoiceState("idle");
        setConversationOn(false);
        conversationOnRef.current = false;
        finishingListenRef.current = false;
        return;
      }
      const text = await transcribeBlakeAudio(blob, "/api/field/ask-blake/transcribe");
      const trimmed = text.trim();
      finishingListenRef.current = false;
      if (!trimmed) {
        if (conversationOnRef.current && phaseRef.current !== "complete") {
          scheduleAutoListen();
        } else {
          setVoiceState("idle");
        }
        return;
      }
      const mode = turnModeForUtterance(stepRef.current, trimmed);
      await sendTurn(mode, trimmed, { voice: true });
    } catch (err) {
      finishingListenRef.current = false;
      setError(err instanceof Error ? err.message : "Listen failed.");
      if (conversationOnRef.current && phaseRef.current !== "complete") {
        scheduleAutoListen();
      } else {
        setVoiceState("idle");
      }
    }
  }

  async function pauseConversation() {
    conversationOnRef.current = false;
    setConversationOn(false);
    clearAutoListenTimer();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    await discardActiveRecorder();
    setVoiceState("idle");
  }

  async function resumeConversation() {
    setError("");
    try {
      await unlockBlakeVoice();
      setSoundReady(true);
    } catch {
      // speak/listen will surface errors
    }
    conversationOnRef.current = true;
    setConversationOn(true);
    await startListening();
  }

  async function onSubmitText() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setDraft("");
    await discardActiveRecorder();
    clearAutoListenTimer();
    const mode = turnModeForUtterance(step, trimmed);
    await sendTurn(mode, trimmed, { voice: false });
  }

  async function onNextStep() {
    await discardActiveRecorder();
    clearAutoListenTimer();
    try {
      await unlockBlakeVoice();
      setSoundReady(true);
    } catch {
      // ignore — speak will prompt Enable sound
    }
    if (!conversationOnRef.current) {
      conversationOnRef.current = true;
      setConversationOn(true);
    }
    await sendTurn("continue", "next", { voice: true });
  }

  const flatSteps = useMemo(() => {
    if (!progress) return [];
    return progress.modules.flatMap((mod) =>
      mod.steps.map((item) => ({
        ...item,
        moduleId: mod.moduleId,
      })),
    );
  }, [progress]);

  const statusLabel = (() => {
    if (voiceState === "listening") {
      return level > SPEECH_LEVEL
        ? `Listening… pause when you’re done (${Math.round(level * 100)}%)`
        : "Your turn — just talk. I’ll reply when you pause.";
    }
    if (voiceState === "thinking") return "Blake is thinking…";
    if (voiceState === "speaking") return "Blake is speaking…";
    if (phase === "complete") return "Training complete";
    if (!conversationOn) return "Conversation paused — resume to keep talking";
    if (step?.kind === "check") return "Answer the check when ready — just speak";
    return "Conversation flowing — say a question, or say next";
  })();

  return (
    <TrainChrome subtitle={flow?.title || "Training session"}>
      <div className="blake-train-session">
        <section className="blake-train-stage">
          <div className="blake-train-stage-head">
            <BlakeCharacter mood={moodForState(voiceState, phase)} size="lg" />
            <div>
              <h1>{module?.title || "Blake Trainer"}</h1>
              <p>
                {step ? `${step.kind === "check" ? "Check-in" : "Step"}: ${step.title}` : "Getting ready…"}
                {progress ? ` · ${progressPercent(progress)}%` : ""}
              </p>
              <div className="blake-train-status">
                <span className={`blake-train-dot ${voiceState}`} />
                <span>{statusLabel}</span>
              </div>
            </div>
          </div>

          {error ? <div className="blake-train-error">{error}</div> : null}
          {phase === "complete" ? (
            <div className="blake-train-ok">Training complete — completion saved for this flow.</div>
          ) : null}

          <div className="blake-train-transcript" aria-live="polite">
            {bubbles.map((bubble, index) => (
              <div key={`${bubble.role}-${index}`} className={`blake-train-bubble ${bubble.role}`}>
                {bubble.text}
                {bubble.citations?.length ? (
                  <div className="blake-train-citations">
                    {bubble.citations.map((cite) => (
                      <span key={cite.materialId}>
                        {cite.kind}: {cite.title}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="blake-train-controls">
            <button type="button" className="blake-train-btn secondary" onClick={onExit}>
              Exit
            </button>
            <button
              type="button"
              className={`blake-train-btn ${soundReady ? "secondary" : "verdigris"}`}
              onClick={() => void enableSoundAndReplay()}
              disabled={voiceState === "thinking" || voiceState === "speaking"}
            >
              <Volume2 size={16} />
              {soundReady ? "Replay Blake" : "Enable sound"}
            </button>
            {supported && phase !== "complete" ? (
              conversationOn ? (
                <button
                  type="button"
                  className="blake-train-btn secondary"
                  onClick={() => void pauseConversation()}
                  disabled={voiceState === "thinking"}
                >
                  <MicOff size={16} />
                  Pause conversation
                </button>
              ) : (
                <button
                  type="button"
                  className="blake-train-btn verdigris"
                  onClick={() => void resumeConversation()}
                  disabled={voiceState === "thinking" || voiceState === "speaking"}
                >
                  <Mic size={16} />
                  Resume conversation
                </button>
              )
            ) : null}
            <button
              type="button"
              className="blake-train-btn secondary"
              onClick={() => void onNextStep()}
              disabled={phase === "complete" || step?.kind === "check" || voiceState === "thinking"}
            >
              <SkipForward size={16} />
              Next step
            </button>
          </div>

          <div className="blake-train-input-row">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onSubmitText();
                }
              }}
              placeholder={step?.kind === "check" ? "Type your check answer…" : "Ask Blake or type next…"}
              aria-label="Message Blake"
            />
            <button type="button" className="blake-train-btn" onClick={() => void onSubmitText()} disabled={!draft.trim()}>
              <SendHorizontal size={16} />
              Send
            </button>
          </div>
        </section>

        <aside className="blake-train-side">
          <div className="blake-train-panel">
            <h3>Module path</h3>
            <div className="blake-train-steps">
              {flatSteps.map((item) => {
                const current = item.stepId === progress?.currentStepId;
                return (
                  <div
                    key={item.stepId}
                    className={`blake-train-step ${item.completed ? "done" : ""} ${current ? "current" : ""}`}
                  >
                    {item.completed ? "✓ " : current ? "→ " : ""}
                    {item.stepId.replace(/^step-/, "").replace(/-/g, " ")}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="blake-train-panel">
            <h3>Grounding rule</h3>
            <p style={{ margin: 0, color: "#5d6673", fontSize: "0.88rem", lineHeight: 1.45 }}>
              Blake only answers from approved company materials. No guessing. If it isn’t in the pack, Blake says so.
            </p>
          </div>
        </aside>
      </div>
    </TrainChrome>
  );
}
