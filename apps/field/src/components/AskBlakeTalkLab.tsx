"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, SendHorizontal } from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/BlakeCharacter";
import type { AskBlakeJobContext, AskBlakeMessage } from "@/lib/ask-blake";
import { startPcmVoiceSession, type PcmVoiceSession } from "@/lib/ask-blake-pcm";
import {
  ensureMicAccess,
  speakBlakeReply,
  speechSupported,
  stopBlakeAudio,
  stopMicStream,
  transcribeBlakeAudio,
  unlockAudioContext,
  unlockBlakeVoice,
} from "@/lib/ask-blake-voice";

type LabState = "idle" | "listening" | "thinking" | "speaking" | "unsupported" | "error";

type AskBlakeTalkLabProps = {
  apiPath?: string;
  speakPath?: string;
  transcribePath?: string;
  job?: AskBlakeJobContext | null;
};

const SPEECH_LEVEL = 0.01;
const SILENCE_MS = 1600;
const MAX_LISTEN_MS = 25000;
const MIN_SPEECH_MS = 400;

/**
 * Sandbox only — flowing voice conversation for testing outside Ask Blake.
 * Uses PCM→WAV capture (not MediaRecorder) so iPhone Safari can feed Whisper.
 */
export function AskBlakeTalkLab({
  apiPath = "/api/ask-blake",
  speakPath = "/api/ask-blake/speak",
  transcribePath = "/api/ask-blake/transcribe",
  job = null,
}: AskBlakeTalkLabProps) {
  const [supported, setSupported] = useState(true);
  const [openaiOk, setOpenaiOk] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<LabState>("idle");
  const [heard, setHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("Tap Start conversation when you’re ready.");
  const [level, setLevel] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [buildTag] = useState("wav-v1");

  const historyRef = useRef<AskBlakeMessage[]>([]);
  const activeRef = useRef(false);
  const listeningRef = useRef(false);
  const finishingRef = useRef(false);
  const heardSpeechRef = useRef(false);
  const speechStartedAtRef = useRef(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const pcmRef = useRef<PcmVoiceSession | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const maxListenTimerRef = useRef<number | null>(null);

  function note(message: string) {
    const stamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog((current) => [`${stamp} · ${message}`, ...current].slice(0, 14));
  }

  useEffect(() => {
    setSupported(speechSupported());
    if (!speechSupported()) setState("unsupported");
    note(`Talk lab ${buildTag}`);
    void (async () => {
      try {
        const response = await fetch(apiPath, { method: "GET" });
        const body = (await response.json().catch(() => ({}))) as { connected?: boolean; error?: string };
        if (!response.ok) {
          setOpenaiOk(false);
          note(body.error || "Sign in to the pilot again.");
          return;
        }
        setOpenaiOk(Boolean(body.connected));
        note(body.connected ? "OpenAI connected — lab ready." : "OpenAI missing — Whisper needs OPENAI_API_KEY.");
      } catch {
        setOpenaiOk(false);
        note("Couldn’t reach Ask Blake status.");
      }
    })();
    return () => {
      stopSession(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPath, buildTag]);

  function clearTimers() {
    for (const ref of [restartTimerRef, silenceTimerRef, maxListenTimerRef]) {
      if (ref.current != null) {
        window.clearTimeout(ref.current);
        ref.current = null;
      }
    }
  }

  function stopSession(updateState = true) {
    activeRef.current = false;
    setActive(false);
    finishingRef.current = false;
    listeningRef.current = false;
    clearTimers();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    const pcm = pcmRef.current;
    pcmRef.current = null;
    if (pcm) void pcm.stop().catch(() => undefined);
    stopMicStream(micStreamRef.current);
    micStreamRef.current = null;
    stopBlakeAudio();
    if (updateState) setState(supported ? "idle" : "unsupported");
    setHeard("");
    setLevel(0);
    setHearing(false);
    setHint("Tap Start conversation when you’re ready.");
  }

  async function ensureOpenMic() {
    if (micStreamRef.current?.getTracks().some((track) => track.readyState === "live")) {
      return micStreamRef.current;
    }
    stopMicStream(micStreamRef.current);
    const stream = await ensureMicAccess();
    micStreamRef.current = stream;
    return stream;
  }

  function scheduleSendFromSilence() {
    if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      if (!heardSpeechRef.current) {
        setHint("Still listening — keep talking, then tap I’m done.");
        return;
      }
      if (Date.now() - speechStartedAtRef.current < MIN_SPEECH_MS) return;
      note("Pause detected — sending clip.");
      void finishListeningAndAsk();
    }, SILENCE_MS);
  }

  async function finishListeningAndAsk() {
    if (!activeRef.current || finishingRef.current || !listeningRef.current) return;
    finishingRef.current = true;
    listeningRef.current = false;
    clearTimers();
    setState("thinking");
    setHint("Transcribing…");
    setHearing(false);

    const pcm = pcmRef.current;
    pcmRef.current = null;
    let blob: Blob | null = null;
    try {
      blob = pcm ? await pcm.stop() : null;
    } catch {
      blob = null;
    }

    if (!blob || blob.size < 1000) {
      note(`Clip empty (${blob?.size ?? 0} bytes) — listening again.`);
      setHint("Didn’t catch audio — speak closer, then tap I’m done.");
      finishingRef.current = false;
      if (activeRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          void startListeningPass();
        }, 500);
      }
      return;
    }

    try {
      note(`Whisper WAV ${(blob.size / 1024).toFixed(0)}KB…`);
      const transcript = await transcribeBlakeAudio(blob, transcribePath);
      setHeard(transcript);
      note(`Heard: ${transcript.slice(0, 80)}`);
      finishingRef.current = false;
      await askBlake(transcript);
    } catch (transcribeError) {
      const message = transcribeError instanceof Error ? transcribeError.message : "Didn’t catch that.";
      setError(message);
      note(`Whisper failed: ${message}`);
      finishingRef.current = false;
      if (activeRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          setError("");
          void startListeningPass();
        }, 1200);
      } else {
        setState("error");
      }
    }
  }

  async function startListeningPass() {
    if (!activeRef.current) return;
    clearTimers();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    stopBlakeAudio();
    if (pcmRef.current) {
      try {
        await pcmRef.current.stop();
      } catch {
        // ignore
      }
      pcmRef.current = null;
    }

    finishingRef.current = false;
    heardSpeechRef.current = false;
    speechStartedAtRef.current = 0;
    setHeard("");
    setError("");
    setHearing(false);
    setLevel(0);
    setState("listening");
    setHint("Speak now — then tap I’m done.");
    note("Listening (PCM/WAV)…");

    let stream: MediaStream;
    try {
      stream = await ensureOpenMic();
      const track = stream.getAudioTracks()[0];
      note(`Mic: ${track?.label || "default"} (${track?.readyState || "?"})`);
    } catch {
      setError("Allow microphone access, then start again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      note("Mic permission blocked.");
      return;
    }

    const context = await unlockAudioContext();
    if (!context) {
      setError("This phone blocked Web Audio.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      note("AudioContext missing.");
      return;
    }
    try {
      await context.resume();
    } catch {
      // ignore
    }
    note(`AudioContext ${context.state} @ ${Math.round(context.sampleRate)}Hz`);

    let peak = 0;
    let lastPeakLog = 0;
    try {
      pcmRef.current = startPcmVoiceSession({
        context,
        stream,
        onLevel: (nextLevel) => {
          if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
          setLevel(nextLevel);
          if (nextLevel > peak) peak = nextLevel;
          const now = Date.now();
          if (now - lastPeakLog > 1000) {
            lastPeakLog = now;
            note(`Level ${Math.round(peak * 100)}%`);
            peak = 0;
          }
          const isSpeech = nextLevel >= SPEECH_LEVEL;
          setHearing(isSpeech);
          if (isSpeech) {
            if (!heardSpeechRef.current) {
              heardSpeechRef.current = true;
              speechStartedAtRef.current = Date.now();
              note("Speech detected.");
            }
            setHint("Hearing you — tap I’m done when finished.");
            if (silenceTimerRef.current != null) {
              window.clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          } else if (heardSpeechRef.current) {
            scheduleSendFromSilence();
          }
        },
      });
    } catch {
      setError("Couldn’t start PCM capture on this phone.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      note("PCM session failed.");
      return;
    }

    listeningRef.current = true;

    maxListenTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      if (heardSpeechRef.current) {
        note("Max listen — sending.");
        void finishListeningAndAsk();
        return;
      }
      setHint("Bar still? Speak closer to the bottom mic, then tap I’m done.");
      note("No speech level yet — tap I’m done after speaking.");
    }, MAX_LISTEN_MS);
  }

  async function askBlake(transcript: string) {
    if (!activeRef.current) return;
    setState("thinking");
    setHint("Blake is thinking…");
    const history = historyRef.current.slice(-10);
    historyRef.current = [...history, { role: "user", text: transcript }];

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 40_000);
      let response: Response;
      try {
        response = await fetch(apiPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: transcript,
            history,
            job,
            mode: "voice",
          }),
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const raw = await response.text();
      let body: { reply?: string; error?: string; warning?: string } = {};
      try {
        body = raw ? JSON.parse(raw) as typeof body : {};
      } catch {
        throw new Error(raw.trim() || "Blake couldn’t reply.");
      }
      if (!response.ok || !body.reply?.trim()) {
        throw new Error(body.error || raw.trim() || "Blake couldn’t reply.");
      }

      const reply = body.reply.trim();
      historyRef.current = [...historyRef.current, { role: "assistant", text: reply }];
      setLastReply(reply);
      if (body.warning) {
        setError(body.warning);
        note(`Warning: ${body.warning}`);
      }
      if (!activeRef.current) return;

      setState("speaking");
      setHint("Blake is talking…");
      note(`Blake: ${reply.slice(0, 80)}`);
      try {
        stopSpeakRef.current = await speakBlakeReply(reply, {
          speakPath,
          onEnd: () => {
            if (!activeRef.current) return;
            note("Reply finished — listening again.");
            restartTimerRef.current = window.setTimeout(() => {
              void startListeningPass();
            }, 450);
          },
        });
      } catch {
        setError("Reply on screen — silent mode may be blocking audio.");
        note("Speak failed — looping back to listen.");
        if (activeRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            void startListeningPass();
          }, 800);
        }
      }
    } catch (askError) {
      const aborted = askError instanceof DOMException && askError.name === "AbortError";
      const message = aborted
        ? "Ask timed out."
        : askError instanceof Error ? askError.message : "Blake couldn’t reply.";
      setError(message);
      note(`Ask failed: ${message}`);
      setState("error");
      setActive(false);
      activeRef.current = false;
    }
  }

  async function toggle() {
    if (!supported) {
      setState("unsupported");
      return;
    }
    if (openaiOk === false) {
      setError("OpenAI isn’t connected — set OPENAI_API_KEY on Render first.");
      setState("error");
      note("Blocked: OpenAI key missing.");
      return;
    }
    if (active) {
      note("Conversation stopped.");
      stopSession();
      return;
    }

    setError("");
    setLastReply("");
    setHeard("");
    setActive(true);
    activeRef.current = true;
    setState("listening");
    setHint("Opening microphone…");
    note(`Starting (${buildTag})…`);
    try {
      await unlockBlakeVoice();
      await unlockAudioContext();
      await ensureOpenMic();
    } catch {
      setError("Allow the microphone, then try again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      stopMicStream(micStreamRef.current);
      micStreamRef.current = null;
      note("Mic unlock failed.");
      return;
    }
    void startListeningPass();
  }

  const mood: BlakeMood =
    state === "listening" ? "guide"
      : state === "thinking" ? "thinking"
        : state === "speaking" ? "good"
          : state === "error" || state === "unsupported" ? "alert"
            : "idle";

  const levelPercent = Math.round(Math.min(1, level) * 100);

  return (
    <section className="ask-blake-voice talk-lab" aria-label="Talk lab">
      <div className={`ask-blake-voice-stage is-${state}${hearing ? " is-hearing" : ""}`}>
        <BlakeCharacter mood={mood} size="hero" />
        <p className="ask-blake-voice-status">
          {state === "listening" ? "Listening"
            : state === "thinking" ? "Thinking…"
              : state === "speaking" ? "Blake talking"
                : state === "unsupported" ? "Mic recording unsupported"
                  : state === "error" ? "Lab issue"
                    : "Conversation lab"}
        </p>
        <p className="ask-blake-voice-hint muted">{hint}</p>
        <p className="talk-lab-build muted">Build {buildTag}</p>
        {state === "listening" ? (
          <div className={`ask-blake-voice-meter${hearing ? " is-hot" : ""}`} role="status">
            <span style={{ width: `${Math.max(8, levelPercent)}%` }} />
          </div>
        ) : null}
        {heard ? <p className="ask-blake-voice-heard">You: {heard}</p> : null}
        {lastReply && state !== "listening" ? (
          <p className="ask-blake-voice-reply">{lastReply}</p>
        ) : null}
      </div>

      {error ? <div className="feedback error">{error}</div> : null}

      <div className="ask-blake-voice-actions">
        <button
          type="button"
          className={`ask-blake-voice-btn${active ? " is-live" : ""}`}
          onClick={() => {
            void toggle();
          }}
          disabled={!supported || state === "unsupported"}
        >
          {active ? <MicOff size={22} /> : <Mic size={22} />}
          <span>{active ? "Stop conversation" : "Start conversation"}</span>
        </button>
        {state === "listening" ? (
          <button
            type="button"
            className="ask-blake-voice-send is-primary-done"
            onClick={() => {
              note("I’m done tapped.");
              void finishListeningAndAsk();
            }}
          >
            <SendHorizontal size={18} />
            <span>I’m done — send to Blake</span>
          </button>
        ) : null}
      </div>

      <p className="ask-blake-voice-hint muted">
        Speak toward the bottom mic. Green bar should move. Then tap <strong>I’m done</strong>.
      </p>

      <div className="talk-lab-log" aria-label="Lab log">
        <p className="talk-lab-log-title">Lab log</p>
        {log.length ? (
          <ul>
            {log.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">Events show here while you test.</p>
        )}
      </div>
    </section>
  );
}
