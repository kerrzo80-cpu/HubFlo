"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, SendHorizontal, SkipForward } from "lucide-react";
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

export function TrainHomeClient() {
  const [role, setRole] = useState<HubRole>("Engineer");
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState("");
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/blake-trainer?role=${encodeURIComponent(role)}`);
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

  if (activeFlowId) {
    return (
      <TrainSession
        flowId={activeFlowId}
        role={role}
        userId={catalog?.userId || "demo-learner"}
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
            Blake talks staff through each module, pauses to check understanding, and answers
            questions only from approved NeXa guides, screenshots, videos, FAQs and company rules.
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
              <button type="button" className="blake-train-btn verdigris" onClick={() => setActiveFlowId(flow.id)}>
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
  onExit,
}: {
  flowId: string;
  role: HubRole;
  userId: string;
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

  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ActiveVoiceRecorder | null>(null);
  const levelMonitorRef = useRef<MicLevelMonitor | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    setSupported(speechSupported());
    void fetch("/api/field/ask-blake")
      .then((res) => res.json())
      .then((data: { connected?: boolean }) => setOpenaiOk(Boolean(data.connected)))
      .catch(() => setOpenaiOk(false));

    void sendTurn("start");
    return () => {
      void hardStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [bubbles, voiceState]);

  function stopLevelMonitor() {
    levelMonitorRef.current?.stop();
    levelMonitorRef.current = null;
    setLevel(0);
  }

  async function hardStop() {
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

  async function speak(text: string) {
    stopSpeakRef.current?.();
    setVoiceState("speaking");
    try {
      await unlockBlakeVoice();
      await new Promise<void>((resolve, reject) => {
        void speakBlakeReply(text, {
          speakPath: "/api/field/ask-blake/speak",
          onEnd: () => resolve(),
        })
          .then((stop) => {
            stopSpeakRef.current = stop;
          })
          .catch(reject);
      });
    } catch {
      // Browser may block audio; transcript still shows.
    } finally {
      stopSpeakRef.current = null;
      setVoiceState("idle");
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
      await speak(data.reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Turn failed.");
      setVoiceState("error");
    } finally {
      busyRef.current = false;
      if (voiceState !== "listening") setVoiceState("idle");
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

  async function startListening() {
    if (!supported || busyRef.current) return;
    setError("");
    try {
      await unlockBlakeVoice();
      stopBlakeAudio();
      const stream = await ensureOpenMic();
      const recorder = await startVoiceRecorder(stream);
      recorderRef.current = recorder;
      levelMonitorRef.current = startMicLevelMonitor(stream, (value) => setLevel(value));
      setVoiceState("listening");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone blocked.");
      setVoiceState("error");
    }
  }

  async function finishListening() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    stopLevelMonitor();
    if (!recorder) {
      setVoiceState("idle");
      return;
    }
    setVoiceState("thinking");
    try {
      const blob = await recorder.stop();
      if (!blob || blob.size < 200) {
        setError("I didn’t catch that — try again.");
        setVoiceState("idle");
        return;
      }
      if (openaiOk === false) {
        setError("Voice transcription needs OpenAI connected (Setup / Connect). You can still type.");
        setVoiceState("idle");
        return;
      }
      const text = await transcribeBlakeAudio(blob, "/api/field/ask-blake/transcribe");
      const trimmed = text.trim();
      if (!trimmed) {
        setError("Could not transcribe — try again or type.");
        setVoiceState("idle");
        return;
      }
      const mode =
        step?.kind === "check" ? "check_answer" : /^(next|continue|done|ok|okay|ready|got it)\b/i.test(trimmed)
          ? "continue"
          : "question";
      await sendTurn(mode, trimmed, { voice: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Listen failed.");
      setVoiceState("idle");
    }
  }

  async function onSubmitText() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setDraft("");
    const mode =
      step?.kind === "check" ? "check_answer" : /^(next|continue|done|ok|okay|ready|got it)\b/i.test(trimmed)
        ? "continue"
        : "question";
    await sendTurn(mode, trimmed, { voice: false });
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

  const listening = voiceState === "listening";

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
                <span>
                  {voiceState === "listening"
                    ? `Listening… ${Math.round(level * 100)}%`
                    : voiceState === "thinking"
                      ? "Blake is thinking…"
                      : voiceState === "speaking"
                        ? "Blake is speaking…"
                        : step?.kind === "check"
                          ? "Answer the check when ready"
                          : "Say a question, or say next"}
                </span>
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
            {supported ? (
              <button
                type="button"
                className={`blake-train-btn ${listening ? "" : "verdigris"}`}
                onClick={() => (listening ? void finishListening() : void startListening())}
                disabled={voiceState === "thinking" || voiceState === "speaking"}
              >
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
                {listening ? "I’m done" : "Start talking"}
              </button>
            ) : null}
            <button
              type="button"
              className="blake-train-btn secondary"
              onClick={() => void sendTurn("continue", "next", { voice: true })}
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
              Blake only answers from approved NeXa materials. No guessing. If it isn’t in the pack, Blake says so.
            </p>
          </div>
        </aside>
      </div>
    </TrainChrome>
  );
}
