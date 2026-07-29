"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, SendHorizontal } from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/field/BlakeCharacter";
import type { AskBlakeJobContext, AskBlakeMessage } from "@/lib/field/ask-blake";
import {
  createSpeechRecognition,
  ensureMicAccess,
  speakBlakeReply,
  speechSupported,
  startMicLevelMonitor,
  startVoiceRecorder,
  stopBlakeAudio,
  stopMicStream,
  transcribeBlakeAudio,
  unlockBlakeVoice,
  voiceStatusLabel,
  type ActiveVoiceRecorder,
  type MicLevelMonitor,
  type VoiceSessionState,
} from "@/lib/field/ask-blake-voice";

type AskBlakeVoiceProps = {
  job?: AskBlakeJobContext | null;
  apiPath?: string;
  speakPath?: string;
  transcribePath?: string;
};

const SPEECH_LEVEL = 0.045;
const SILENCE_MS = 1500;
const MAX_LISTEN_MS = 22000;
const MIN_SPEECH_MS = 450;

type SpeechRec = NonNullable<ReturnType<typeof createSpeechRecognition>>;

export function AskBlakeVoice({
  job = null,
  apiPath = "/api/field/ask-blake",
  speakPath = "/api/field/ask-blake/speak",
  transcribePath = "/api/field/ask-blake/transcribe",
}: AskBlakeVoiceProps) {
  const [supported, setSupported] = useState(true);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<VoiceSessionState>("idle");
  const [heard, setHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("Tap Start talking, then speak toward the bottom of the phone.");
  const [level, setLevel] = useState(0);
  const [hearing, setHearing] = useState(false);
  const historyRef = useRef<AskBlakeMessage[]>([]);
  const activeRef = useRef(false);
  const listeningRef = useRef(false);
  const finishingRef = useRef(false);
  const heardSpeechRef = useRef(false);
  const speechStartedAtRef = useRef(0);
  const transcriptRef = useRef("");
  const interimRef = useRef("");
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ActiveVoiceRecorder | null>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const levelMonitorRef = useRef<MicLevelMonitor | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const maxListenTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSupported(speechSupported());
    if (!speechSupported()) setState("unsupported");
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
    return () => {
      stopSession(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearTimers() {
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (silenceTimerRef.current != null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxListenTimerRef.current != null) {
      window.clearTimeout(maxListenTimerRef.current);
      maxListenTimerRef.current = null;
    }
  }

  function stopLevelMonitor() {
    levelMonitorRef.current?.stop();
    levelMonitorRef.current = null;
    setLevel(0);
    setHearing(false);
  }

  function stopRecognition() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // ignore
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
    stopLevelMonitor();
    stopRecognition();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      void recorder.stop().catch(() => undefined);
    }
    stopMicStream(micStreamRef.current);
    micStreamRef.current = null;
    stopBlakeAudio();
    transcriptRef.current = "";
    interimRef.current = "";
    if (updateState) setState(supported ? "idle" : "unsupported");
    setHeard("");
    setHint("Tap Start talking, then speak toward the bottom of the phone.");
  }

  async function ensureOpenMic() {
    if (micStreamRef.current) {
      const live = micStreamRef.current.getTracks().some((track) => track.readyState === "live");
      if (live) return micStreamRef.current;
      stopMicStream(micStreamRef.current);
      micStreamRef.current = null;
    }
    const stream = await ensureMicAccess();
    micStreamRef.current = stream;
    return stream;
  }

  function scheduleSendFromSilence() {
    if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      const spoken = (transcriptRef.current || interimRef.current).trim();
      if (!heardSpeechRef.current && !spoken) {
        setHint("Still listening — say the fault out loud.");
        return;
      }
      const spokenFor = Date.now() - (speechStartedAtRef.current || Date.now());
      if (heardSpeechRef.current && spokenFor < MIN_SPEECH_MS && !spoken) return;
      void finishListeningAndAsk();
    }, SILENCE_MS);
  }

  function startBrowserSpeechCaption() {
    stopRecognition();
    const recognition = createSpeechRecognition({ continuous: true });
    if (!recognition) return;
    recognitionRef.current = recognition;
    recognition.onresult = (event) => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      let finalChunk = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalChunk += `${text} `;
        else interim += text;
      }
      if (finalChunk.trim()) {
        transcriptRef.current = `${transcriptRef.current} ${finalChunk}`.trim();
        heardSpeechRef.current = true;
        if (!speechStartedAtRef.current) speechStartedAtRef.current = Date.now();
      }
      interimRef.current = interim.trim();
      const display = (transcriptRef.current || interimRef.current).trim();
      if (display) {
        setHeard(display);
        setHint("Got that — pause when finished, or tap I’m done.");
        scheduleSendFromSilence();
      }
    };
    recognition.onerror = () => {
      // Browser speech is a bonus — Whisper / I’m done still work.
    };
    recognition.onend = () => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      try {
        recognition.start();
      } catch {
        // ignore
      }
    };
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
    }
  }

  async function finishListeningAndAsk() {
    if (!activeRef.current || finishingRef.current || !listeningRef.current) return;
    finishingRef.current = true;
    listeningRef.current = false;
    clearTimers();
    stopLevelMonitor();
    stopRecognition();
    setState("thinking");
    setHint("Blake is catching that…");

    const browserText = (transcriptRef.current || interimRef.current || heard).trim();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    let blob: Blob | null = null;
    try {
      blob = recorder ? await recorder.stop() : null;
    } catch {
      blob = null;
    }

    let transcript = browserText;
    if (blob && blob.size >= 200) {
      try {
        transcript = await transcribeBlakeAudio(blob, transcribePath);
      } catch (transcribeError) {
        if (!transcript) {
          setError(
            transcribeError instanceof Error
              ? transcribeError.message
              : "Didn’t catch that — try again.",
          );
          finishingRef.current = false;
          if (activeRef.current) {
            setHint("Speak clearly, then tap I’m done.");
            restartTimerRef.current = window.setTimeout(() => {
              setError("");
              void startListeningPass();
            }, 900);
          } else {
            setState("error");
          }
          return;
        }
      }
    }

    if (!transcript) {
      setHint("Didn’t catch that — speak closer to the bottom mic, then tap I’m done.");
      finishingRef.current = false;
      if (activeRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          void startListeningPass();
        }, 500);
      }
      return;
    }

    setHeard(transcript);
    finishingRef.current = false;
    await askBlake(transcript);
  }

  async function startListeningPass() {
    if (!activeRef.current) return;
    clearTimers();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    stopBlakeAudio();
    stopLevelMonitor();
    stopRecognition();
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
    transcriptRef.current = "";
    interimRef.current = "";
    setHeard("");
    setHint("Listening now — speak clearly toward the bottom mic.");
    setState("listening");
    setError("");
    setHearing(false);

    let stream: MediaStream;
    try {
      stream = await ensureOpenMic();
    } catch {
      setError("Allow microphone access for Ask Blake, then tap Start talking again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      return;
    }

    let recorder: ActiveVoiceRecorder;
    try {
      recorder = startVoiceRecorder(stream);
    } catch {
      setError("This phone blocked audio recording. Try Safari or Chrome, then Start talking again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      return;
    }

    recorderRef.current = recorder;
    listeningRef.current = true;
    startBrowserSpeechCaption();

    levelMonitorRef.current = startMicLevelMonitor(stream, (nextLevel) => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      setLevel(nextLevel);
      const isSpeech = nextLevel >= SPEECH_LEVEL;
      setHearing(isSpeech);
      if (isSpeech) {
        if (!heardSpeechRef.current) {
          heardSpeechRef.current = true;
          speechStartedAtRef.current = Date.now();
        }
        if (!transcriptRef.current && !interimRef.current) {
          setHint("Hearing you — pause when finished, or tap I’m done.");
        }
        if (silenceTimerRef.current != null) {
          window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else if (heardSpeechRef.current || transcriptRef.current || interimRef.current) {
        scheduleSendFromSilence();
      }
    });

    maxListenTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current || !listeningRef.current || finishingRef.current) return;
      if (heardSpeechRef.current || transcriptRef.current || interimRef.current) {
        void finishListeningAndAsk();
        return;
      }
      setHint("Still listening — try speaking a bit louder, then tap I’m done.");
    }, MAX_LISTEN_MS);
  }

  async function askBlake(transcript: string) {
    if (!activeRef.current) return;
    listeningRef.current = false;
    setState("thinking");
    setHeard(transcript);
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
      let body: {
        reply?: string;
        error?: string;
        warning?: string;
      } = {};
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
      if (body.warning) setError(body.warning);
      if (!activeRef.current) return;

      setState("speaking");
      setHint("Blake is talking…");
      try {
        stopSpeakRef.current = await speakBlakeReply(reply, {
          speakPath,
          onEnd: () => {
            if (!activeRef.current) return;
            restartTimerRef.current = window.setTimeout(() => {
              void startListeningPass();
            }, 400);
          },
        });
      } catch {
        setError("Blake replied on screen — turn silent mode off to hear him next time.");
        if (activeRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            void startListeningPass();
          }, 700);
        }
      }
    } catch (askError) {
      const aborted = askError instanceof DOMException && askError.name === "AbortError";
      setError(
        aborted
          ? "Blake took too long — check signal and try Start talking again."
          : askError instanceof Error ? askError.message : "Blake couldn’t reply.",
      );
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
    if (active) {
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
    try {
      await unlockBlakeVoice();
      await ensureOpenMic();
    } catch {
      setError("Allow the microphone for Ask Blake, then tap Start talking again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      stopMicStream(micStreamRef.current);
      micStreamRef.current = null;
      return;
    }
    restartTimerRef.current = window.setTimeout(() => {
      void startListeningPass();
    }, 200);
  }

  function sendHeardNow() {
    if (state !== "listening" || finishingRef.current) return;
    void finishListeningAndAsk();
  }

  const mood: BlakeMood =
    state === "listening" ? "guide"
      : state === "thinking" ? "thinking"
        : state === "speaking" ? "good"
          : state === "error" ? "alert"
            : "idle";

  const levelPercent = Math.round(Math.min(1, level) * 100);

  return (
    <section className="ask-blake-voice" aria-label="Talk to Blake">
      <div className={`ask-blake-voice-stage is-${state}${hearing ? " is-hearing" : ""}`}>
        <BlakeCharacter mood={mood} size="hero" />
        <p className="ask-blake-voice-status">{voiceStatusLabel(state)}</p>
        <p className="ask-blake-voice-hint muted">{hint}</p>
        {state === "listening" ? (
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
          className={`ask-blake-voice-btn${active ? " is-live" : ""}`}
          onClick={() => {
            void toggle();
          }}
          disabled={!supported && state === "unsupported"}
        >
          {active ? <MicOff size={22} /> : <Mic size={22} />}
          <span>{active ? "Stop talking" : "Start talking"}</span>
        </button>
        {state === "listening" ? (
          <button type="button" className="ask-blake-voice-send" onClick={sendHeardNow}>
            <SendHorizontal size={18} />
            <span>I’m done</span>
          </button>
        ) : null}
      </div>

      <p className="ask-blake-voice-hint muted">
        Speak toward the bottom of the iPhone. Watch the green bar — then pause or tap I’m done.
      </p>
    </section>
  );
}
