"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/BlakeCharacter";
import type { AskBlakeJobContext, AskBlakeMessage } from "@/lib/ask-blake";
import {
  createSpeechRecognition,
  speakText,
  speechSupported,
  voiceStatusLabel,
  type VoiceSessionState,
} from "@/lib/ask-blake-voice";

type AskBlakeVoiceProps = {
  job?: AskBlakeJobContext | null;
  apiPath?: string;
};

export function AskBlakeVoice({ job = null, apiPath = "/api/ask-blake" }: AskBlakeVoiceProps) {
  const [supported, setSupported] = useState(true);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<VoiceSessionState>("idle");
  const [heard, setHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [error, setError] = useState("");
  const historyRef = useRef<AskBlakeMessage[]>([]);
  const activeRef = useRef(false);
  const transcriptRef = useRef("");
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const restartTimerRef = useRef<number | null>(null);

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

  function clearRestart() {
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }

  function stopSession(updateState = true) {
    activeRef.current = false;
    setActive(false);
    clearRestart();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    transcriptRef.current = "";
    if (updateState) setState(supported ? "idle" : "unsupported");
    setHeard("");
  }

  function listen() {
    if (!activeRef.current) return;
    clearRestart();
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    transcriptRef.current = "";
    setHeard("");

    const recognition = createSpeechRecognition();
    if (!recognition) {
      setSupported(false);
      setState("unsupported");
      setActive(false);
      activeRef.current = false;
      return;
    }

    recognitionRef.current = recognition;

    recognition.onstart = () => {
      if (!activeRef.current) return;
      setState("listening");
      setError("");
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      if (finalText.trim()) {
        transcriptRef.current = `${transcriptRef.current} ${finalText}`.trim();
      }
      setHeard((transcriptRef.current || interim).trim());
    };

    recognition.onerror = (event) => {
      const code = event.error ?? "error";
      if (code === "aborted" || code === "no-speech") {
        if (activeRef.current) {
          restartTimerRef.current = window.setTimeout(() => listen(), 350);
        }
        return;
      }
      setError(code === "not-allowed"
        ? "Allow the mic for Ask Blake, then tap Start talking again."
        : "Couldn’t hear that clearly — tap Start talking and try again.");
      setState("error");
      setActive(false);
      activeRef.current = false;
    };

    recognition.onend = () => {
      if (!activeRef.current) return;
      const transcript = transcriptRef.current.trim();
      if (!transcript) {
        restartTimerRef.current = window.setTimeout(() => listen(), 350);
        return;
      }
      void askBlake(transcript);
    };

    try {
      recognition.start();
    } catch {
      restartTimerRef.current = window.setTimeout(() => listen(), 400);
    }
  }

  async function askBlake(transcript: string) {
    if (!activeRef.current) return;
    setState("thinking");
    setHeard(transcript);

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
      stopSpeakRef.current = speakText(reply, () => {
        if (!activeRef.current) return;
        restartTimerRef.current = window.setTimeout(() => listen(), 280);
      });
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "Blake couldn’t reply.");
      setState("error");
      setActive(false);
      activeRef.current = false;
    }
  }

  function toggle() {
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
    listen();
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
        {heard ? <p className="ask-blake-voice-heard">You: {heard}</p> : null}
        {lastReply && state !== "listening" ? (
          <p className="ask-blake-voice-reply">{lastReply}</p>
        ) : null}
      </div>

      {error ? <div className="feedback error">{error}</div> : null}

      <button
        type="button"
        className={`ask-blake-voice-btn${active ? " is-live" : ""}`}
        onClick={toggle}
        disabled={!supported && state === "unsupported"}
      >
        {active ? <MicOff size={22} /> : <Mic size={22} />}
        <span>{active ? "Stop talking" : "Start talking"}</span>
      </button>

      <p className="ask-blake-voice-hint muted">
        Put the phone by the boiler or under the sink. Tap once — then just talk. Blake answers out loud and keeps listening until you stop.
      </p>
    </section>
  );
}
