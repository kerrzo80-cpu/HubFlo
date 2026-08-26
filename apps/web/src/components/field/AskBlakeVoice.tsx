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
  type VoiceSessionState,
} from "@/lib/field/ask-blake-voice";

type AskBlakeVoiceProps = {
  job?: AskBlakeJobContext | null;
  apiPath?: string;
  speakPath?: string;
  transcribePath?: string;
  /** When false, Talk can’t hear you on this pilot (Whisper needs OpenAI). */
  openaiConnected?: boolean | null;
};

const SPEECH_LEVEL = 0.04;

/**
 * Push-to-talk only: Start → speak → I’m done → Ayla answers once.
 * Continuous auto-listen loops are too unreliable on iPhone Safari.
 */
export function AskBlakeVoice({
  job = null,
  apiPath = "/api/field/ask-ayla",
  speakPath = "/api/field/ask-ayla/speak",
  transcribePath = "/api/field/ask-ayla/transcribe",
  openaiConnected = null,
}: AskBlakeVoiceProps) {
  const [supported, setSupported] = useState(true);
  const [state, setState] = useState<VoiceSessionState>("idle");
  const [heard, setHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("Tap Start talking, say the fault, then tap I’m done.");
  const [level, setLevel] = useState(0);
  const [hearing, setHearing] = useState(false);

  const historyRef = useRef<AskBlakeMessage[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ActiveVoiceRecorder | null>(null);
  const levelMonitorRef = useRef<MicLevelMonitor | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const recordingRef = useRef(false);

  const talkReady = openaiConnected !== false;
  const recording = state === "listening";

  useEffect(() => {
    setSupported(speechSupported());
    if (!speechSupported()) setState("unsupported");
    return () => {
      void hardStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopLevelMonitor() {
    levelMonitorRef.current?.stop();
    levelMonitorRef.current = null;
    setLevel(0);
    setHearing(false);
  }

  async function hardStop() {
    recordingRef.current = false;
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

  async function ensureOpenMic() {
    if (micStreamRef.current?.getTracks().some((track) => track.readyState === "live")) {
      return micStreamRef.current;
    }
    stopMicStream(micStreamRef.current);
    const stream = await ensureMicAccess();
    micStreamRef.current = stream;
    return stream;
  }

  async function startRecording() {
    if (!supported || !talkReady || recordingRef.current) return;
    setError("");
    setLastReply("");
    setHeard("");
    setHint("Opening microphone…");
    setState("listening");

    try {
      await unlockBlakeVoice();
      const stream = await ensureOpenMic();
      const recorder = startVoiceRecorder(stream);
      recorderRef.current = recorder;
      recordingRef.current = true;
      setHint("Speak now — tap I’m done when you’ve finished.");
      levelMonitorRef.current = startMicLevelMonitor(stream, (nextLevel) => {
        if (!recordingRef.current) return;
        setLevel(nextLevel);
        const hot = nextLevel >= SPEECH_LEVEL;
        setHearing(hot);
        if (hot) setHint("Hearing you — keep going, then tap I’m done.");
      });
    } catch {
      recordingRef.current = false;
      setError("Allow the microphone for Ask Ayla, then try again.");
      setState("error");
      stopMicStream(micStreamRef.current);
      micStreamRef.current = null;
    }
  }

  async function finishAndAsk() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    stopLevelMonitor();
    setState("thinking");
    setHint("Ayla is catching that…");

    const recorder = recorderRef.current;
    recorderRef.current = null;
    let blob: Blob | null = null;
    try {
      blob = recorder ? await recorder.stop() : null;
    } catch {
      blob = null;
    }

    if (!blob || blob.size < 400) {
      setError("That clip was too short — tap Start talking and try again.");
      setState("idle");
      setHint("Tap Start talking, say the fault, then tap I’m done.");
      return;
    }

    let transcript = "";
    try {
      transcript = await transcribeBlakeAudio(blob, transcribePath);
    } catch (transcribeError) {
      setError(transcribeError instanceof Error ? transcribeError.message : "Didn’t catch that.");
      setState("error");
      setHint("Try again, or switch to Type / photos.");
      return;
    }

    setHeard(transcript);
    await askBlake(transcript);
  }

  async function askBlake(transcript: string) {
    setState("thinking");
    setHint("Ayla is thinking…");
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
        throw new Error(raw.trim() || "Ayla couldn’t reply.");
      }
      if (!response.ok || !body.reply?.trim()) {
        throw new Error(body.error || raw.trim() || "Ayla couldn’t reply.");
      }

      const reply = body.reply.trim();
      historyRef.current = [...historyRef.current, { role: "assistant", text: reply }];
      setLastReply(reply);
      if (body.warning) setError(body.warning);

      setState("speaking");
      setHint("Ayla is talking…");
      try {
        stopSpeakRef.current = await speakBlakeReply(reply, {
          speakPath,
          onEnd: () => {
            setState("idle");
            setHint("Tap Start talking for another question.");
          },
        });
      } catch {
        setError("Blake replied on screen — turn silent mode off to hear him.");
        setState("idle");
        setHint("Tap Start talking for another question.");
      }
    } catch (askError) {
      const aborted = askError instanceof DOMException && askError.name === "AbortError";
      setError(
        aborted
          ? "Blake took too long — check signal and try again."
          : askError instanceof Error ? askError.message : "Ayla couldn’t reply.",
      );
      setState("error");
      setHint("Try again, or use Type / photos.");
    }
  }

  async function onPrimary() {
    if (recording) {
      await hardStop();
      setState("idle");
      setHint("Stopped. Tap Start talking when you’re ready.");
      return;
    }
    if (state === "thinking" || state === "speaking") {
      await hardStop();
      setState("idle");
      setHint("Tap Start talking, say the fault, then tap I’m done.");
      return;
    }
    await startRecording();
  }

  const mood: BlakeMood =
    state === "listening" ? "guide"
      : state === "thinking" ? "thinking"
        : state === "speaking" ? "good"
          : state === "error" ? "alert"
            : "idle";

  const levelPercent = Math.round(Math.min(1, level) * 100);
  const statusLabel =
    state === "listening" ? "Recording — talk to Ayla"
      : state === "thinking" ? "Ayla is thinking…"
        : state === "speaking" ? "Blake is talking"
          : state === "unsupported" ? "This phone can’t record for Ask Ayla"
            : state === "error" ? "Try again, or use Type / photos"
              : "Push to talk";

  if (!supported) {
    return (
      <section className="ask-blake-voice" aria-label="Talk to Ayla">
        <div className="ask-blake-voice-stage is-unsupported">
          <BlakeCharacter mood="alert" size="hero" />
          <p className="ask-blake-voice-status">Talk isn’t available on this phone</p>
          <p className="ask-blake-voice-hint muted">Use Type / photos instead — that path is solid.</p>
        </div>
      </section>
    );
  }

  if (openaiConnected === false) {
    return (
      <section className="ask-blake-voice" aria-label="Talk to Ayla">
        <div className="ask-blake-voice-stage is-unsupported">
          <BlakeCharacter mood="alert" size="hero" />
          <p className="ask-blake-voice-status">Talk needs OpenAI on this pilot</p>
          <p className="ask-blake-voice-hint muted">
            Listening isn’t connected yet. Use <strong>Type / photos</strong> for now — that works without the voice key.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="ask-blake-voice" aria-label="Talk to Ayla">
      <div className={`ask-blake-voice-stage is-${state}${hearing ? " is-hearing" : ""}`}>
        <BlakeCharacter mood={mood} size="hero" />
        <p className="ask-blake-voice-status">{statusLabel}</p>
        <p className="ask-blake-voice-hint muted">{hint}</p>
        {recording ? (
          <div
            className={`ask-blake-voice-meter${hearing ? " is-hot" : ""}`}
            role="status"
            aria-label={hearing ? "Hearing you" : "Waiting for speech"}
          >
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
          className={`ask-blake-voice-btn${recording ? " is-live" : ""}`}
          onClick={() => {
            void onPrimary();
          }}
          disabled={state === "thinking"}
        >
          {recording ? <MicOff size={22} /> : <Mic size={22} />}
          <span>
            {recording ? "Cancel"
              : state === "thinking" ? "Working…"
                : "Start talking"}
          </span>
        </button>
        {recording ? (
          <button
            type="button"
            className="ask-blake-voice-send"
            onClick={() => {
              void finishAndAsk();
            }}
          >
            <SendHorizontal size={18} />
            <span>I’m done</span>
          </button>
        ) : null}
      </div>

      <p className="ask-blake-voice-hint muted">
        One clip at a time: Start → speak → I’m done. Silent switch off to hear Blake’s reply.
      </p>
    </section>
  );
}
