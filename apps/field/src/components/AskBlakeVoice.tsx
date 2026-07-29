"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, SendHorizontal } from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/BlakeCharacter";
import type { AskBlakeJobContext, AskBlakeMessage } from "@/lib/ask-blake";
import {
  createSpeechRecognition,
  ensureMicAccess,
  speakBlakeReply,
  speechSupported,
  stopBlakeAudio,
  stopMicStream,
  unlockBlakeVoice,
  voiceStatusLabel,
  type VoiceSessionState,
} from "@/lib/ask-blake-voice";

type AskBlakeVoiceProps = {
  job?: AskBlakeJobContext | null;
  apiPath?: string;
  speakPath?: string;
};

const SILENCE_MS = 1600;
const MAX_LISTEN_MS = 20000;

export function AskBlakeVoice({
  job = null,
  apiPath = "/api/ask-blake",
  speakPath = "/api/ask-blake/speak",
}: AskBlakeVoiceProps) {
  const [supported, setSupported] = useState(true);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<VoiceSessionState>("idle");
  const [heard, setHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("Tap Start talking, then speak toward the bottom of the phone.");
  const historyRef = useRef<AskBlakeMessage[]>([]);
  const activeRef = useRef(false);
  const listeningRef = useRef(false);
  const transcriptRef = useRef("");
  const interimRef = useRef("");
  const micStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
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

  function stopRecognition() {
    listeningRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    }
    recognitionRef.current = null;
  }

  function stopSession(updateState = true) {
    activeRef.current = false;
    setActive(false);
    clearTimers();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    stopRecognition();
    stopMicStream(micStreamRef.current);
    micStreamRef.current = null;
    stopBlakeAudio();
    transcriptRef.current = "";
    interimRef.current = "";
    if (updateState) setState(supported ? "idle" : "unsupported");
    setHeard("");
    setHint("Tap Start talking, then speak toward the bottom of the phone.");
  }

  function scheduleSendFromSilence() {
    if (silenceTimerRef.current != null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current || !listeningRef.current) return;
      const transcript = transcriptRef.current.trim();
      if (!transcript) {
        setHint("Still listening — say the fault out loud.");
        return;
      }
      finishListeningAndAsk(transcript);
    }, SILENCE_MS);
  }

  function finishListeningAndAsk(transcript: string) {
    if (!transcript.trim()) return;
    clearTimers();
    listeningRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    void askBlake(transcript.trim());
  }

  async function startListeningPass() {
    if (!activeRef.current) return;
    clearTimers();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    stopBlakeAudio();
    stopRecognition();
    transcriptRef.current = "";
    interimRef.current = "";
    setHeard("");
    setHint("Listening now — speak clearly toward the bottom mic.");
    setState("listening");
    setError("");

    try {
      // Ask for mic permission first, then release so SpeechRecognition can own the mic.
      const permissionStream = await ensureMicAccess();
      stopMicStream(permissionStream);
      micStreamRef.current = null;
    } catch {
      setError("Allow microphone access for Ask Blake, then tap Start talking again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      return;
    }

    const recognition = createSpeechRecognition({ continuous: true });
    if (!recognition) {
      setSupported(false);
      setState("unsupported");
      setActive(false);
      activeRef.current = false;
      return;
    }

    recognitionRef.current = recognition;
    listeningRef.current = true;

    recognition.onstart = () => {
      if (!activeRef.current) return;
      setState("listening");
      setHint("Go ahead — Blake is listening.");
    };

    recognition.onresult = (event) => {
      if (!activeRef.current || !listeningRef.current) return;
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
      }
      interimRef.current = interim.trim();
      const display = (transcriptRef.current || interimRef.current).trim();
      setHeard(display);
      if (display) {
        setHint("Got it — pause when you’ve finished and Blake will answer.");
        scheduleSendFromSilence();
      }
    };

    recognition.onerror = (event) => {
      const code = event.error ?? "error";
      if (code === "aborted") return;
      if (code === "no-speech") {
        setHint("Didn’t catch that — keep talking toward the phone.");
        if (activeRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            void startListeningPass();
          }, 400);
        }
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone blocked. Allow mic for Safari / Chrome, then try again.");
        setState("error");
        setActive(false);
        activeRef.current = false;
        return;
      }
      setHint("Listening glitch — trying again.");
      if (activeRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          void startListeningPass();
        }, 500);
      }
    };

    recognition.onend = () => {
      if (!activeRef.current) return;
      // If we already moved to thinking/speaking, do nothing.
      if (!listeningRef.current) return;
      const transcript = transcriptRef.current.trim();
      if (transcript) {
        finishListeningAndAsk(transcript);
        return;
      }
      // iOS often ends recognition unexpectedly — restart while session is live.
      restartTimerRef.current = window.setTimeout(() => {
        void startListeningPass();
      }, 350);
    };

    maxListenTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current || !listeningRef.current) return;
      const transcript = transcriptRef.current.trim();
      if (transcript) finishListeningAndAsk(transcript);
      else setHint("Still listening — try speaking a bit louder or closer.");
    }, MAX_LISTEN_MS);

    try {
      recognition.start();
    } catch {
      restartTimerRef.current = window.setTimeout(() => {
        void startListeningPass();
      }, 450);
    }
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
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: transcript,
          history,
          job,
          mode: "voice",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };
      if (!response.ok || !body.reply?.trim()) {
        throw new Error(body.error ?? "Blake couldn’t reply.");
      }

      const reply = body.reply.trim();
      historyRef.current = [...historyRef.current, { role: "assistant", text: reply }];
      setLastReply(reply);
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
        setError("Blake replied on screen, but the phone blocked the voice. Check silent mode is off.");
        if (activeRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            void startListeningPass();
          }, 700);
        }
      }
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "Blake couldn’t reply.");
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
      micStreamRef.current = await ensureMicAccess();
    } catch {
      setError("Allow the microphone for Ask Blake, then tap Start talking again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
      return;
    }
    // Give iOS a beat to release the unlock audio before recognition starts.
    restartTimerRef.current = window.setTimeout(() => {
      void startListeningPass();
    }, 350);
  }

  function sendHeardNow() {
    const transcript = (transcriptRef.current || heard).trim();
    if (!transcript || state !== "listening") return;
    finishListeningAndAsk(transcript);
  }

  const mood: BlakeMood =
    state === "listening" ? "guide"
      : state === "thinking" ? "thinking"
        : state === "speaking" ? "good"
          : state === "error" ? "alert"
            : "idle";

  return (
    <section className="ask-blake-voice" aria-label="Talk to Blake">
      <div className={`ask-blake-voice-stage is-${state}`}>
        <BlakeCharacter mood={mood} size="hero" />
        <p className="ask-blake-voice-status">{voiceStatusLabel(state)}</p>
        <p className="ask-blake-voice-hint muted">{hint}</p>
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
        {state === "listening" && heard.trim() ? (
          <button type="button" className="ask-blake-voice-send" onClick={sendHeardNow}>
            <SendHorizontal size={18} />
            <span>Send that</span>
          </button>
        ) : null}
      </div>

      <p className="ask-blake-voice-hint muted">
        Speak toward the bottom of the iPhone. If the live text appears, pause — or tap Send that.
      </p>
    </section>
  );
}
