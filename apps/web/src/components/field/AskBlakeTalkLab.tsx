"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, SendHorizontal } from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/field/BlakeCharacter";
import type { AskBlakeJobContext, AskBlakeMessage } from "@/lib/field/ask-blake";
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
} from "@/lib/field/ask-blake-voice";

type LabState = "idle" | "listening" | "thinking" | "speaking" | "unsupported" | "error";

type AskBlakeTalkLabProps = {
  apiPath?: string;
  speakPath?: string;
  transcribePath?: string;
  job?: AskBlakeJobContext | null;
};

const SPEECH_LEVEL = 0.045;
const SILENCE_MS = 1400;
const MAX_LISTEN_MS = 20000;
const MIN_SPEECH_MS = 500;

/**
 * Sandbox only — flowing voice conversation for testing outside Ask Blake.
 * Not linked from Field tabs until this loop is solid on iPhone.
 */
export function AskBlakeTalkLab({
  apiPath = "/api/field/ask-blake",
  speakPath = "/api/field/ask-blake/speak",
  transcribePath = "/api/field/ask-blake/transcribe",
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

  const historyRef = useRef<AskBlakeMessage[]>([]);
  const activeRef = useRef(false);
  const listeningRef = useRef(false);
  const finishingRef = useRef(false);
  const heardSpeechRef = useRef(false);
  const speechStartedAtRef = useRef(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ActiveVoiceRecorder | null>(null);
  const levelMonitorRef = useRef<MicLevelMonitor | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const maxListenTimerRef = useRef<number | null>(null);

  function note(message: string) {
    const stamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog((current) => [`${stamp} · ${message}`, ...current].slice(0, 12));
  }

  useEffect(() => {
    setSupported(speechSupported());
    if (!speechSupported()) setState("unsupported");
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
        note(body.connected ? "OpenAI connected — lab ready." : "OpenAI missing — Whisper/TTS need the key.");
      } catch {
        setOpenaiOk(false);
        note("Couldn’t reach Ask Blake status.");
      }
    })();
    return () => {
      stopSession(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPath]);

  function clearTimers() {
    for (const ref of [restartTimerRef, silenceTimerRef, maxListenTimerRef]) {
      if (ref.current != null) {
        window.clearTimeout(ref.current);
        ref.current = null;
      }
    }
  }

  function stopLevelMonitor() {
    levelMonitorRef.current?.stop();
    levelMonitorRef.current = null;
    setLevel(0);
    setHearing(false);
  }

  function stopSession(updateState = true) {
    activeRef.current = false;
    setActive(false);
    finishingRef.current = false;
    listeningRef.current = false;
    clearTimers();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    stopLevelMonitor();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) void recorder.stop().catch(() => undefined);
    stopMicStream(micStreamRef.current);
    micStreamRef.current = null;
    stopBlakeAudio();
    if (updateState) setState(supported ? "idle" : "unsupported");
    setHeard("");
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
        setHint("Still listening — keep talking.");
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
    stopLevelMonitor();
    setState("thinking");
    setHint("Transcribing…");

    const recorder = recorderRef.current;
    recorderRef.current = null;
    let blob: Blob | null = null;
    try {
      blob = recorder ? await recorder.stop() : null;
    } catch {
      blob = null;
    }

    if (!blob || blob.size < 400) {
      note("Clip empty — listening again.");
      finishingRef.current = false;
      if (activeRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          void startListeningPass();
        }, 400);
      }
      return;
    }

    try {
      note(`Whisper clip ${(blob.size / 1024).toFixed(0)}KB…`);
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
        }, 1000);
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
    stopLevelMonitor();
    if (recorderRef.current) {
      try {
        await recorderRef.current.stop();
      } catch {
        // ignore
      }
      recorderRef.current = null;
    }

    finishingRef.current = false;
    heardSpeechRef.current = false;
    speechStartedAtRef.current = 0;
    setHeard("");
    setError("");
    setHearing(false);
    setState("listening");
    setHint("Your turn — speak, then pause.");
    note("Listening…");

    let stream: MediaStream;
    try {
      stream = await ensureOpenMic();
    } catch {
      setError("Allow microphone access, then start again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      note("Mic permission blocked.");
      return;
    }

    let recorder: ActiveVoiceRecorder;
    try {
      recorder = startVoiceRecorder(stream);
    } catch {
      setError("Recording blocked on this phone.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      note("MediaRecorder failed.");
      return;
    }

    recorderRef.current = recorder;
    listeningRef.current = true;

    levelMonitorRef.current = startMicLevelMonitor(stream, (nextLevel) => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      setLevel(nextLevel);
      const isSpeech = nextLevel >= SPEECH_LEVEL;
      setHearing(isSpeech);
      if (isSpeech) {
        if (!heardSpeechRef.current) {
          heardSpeechRef.current = true;
          speechStartedAtRef.current = Date.now();
          note("Speech detected.");
        }
        setHint("Hearing you — pause when finished.");
        if (silenceTimerRef.current != null) {
          window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else if (heardSpeechRef.current) {
        scheduleSendFromSilence();
      }
    });

    maxListenTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      if (heardSpeechRef.current) {
        note("Max listen — sending.");
        void finishListeningAndAsk();
        return;
      }
      setHint("Still listening — speak a bit louder, or tap I’m done.");
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
      setError("OpenAI isn’t connected on this pilot — set OPENAI_API_KEY on Render first.");
      setState("error");
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
    note("Starting conversation…");
    try {
      await unlockBlakeVoice();
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
    restartTimerRef.current = window.setTimeout(() => {
      void startListeningPass();
    }, 250);
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
            className="ask-blake-voice-send"
            onClick={() => {
              note("I’m done tapped.");
              void finishListeningAndAsk();
            }}
          >
            <SendHorizontal size={18} />
            <span>I’m done</span>
          </button>
        ) : null}
      </div>

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
