"use client";

export type VoiceSessionState = "idle" | "listening" | "thinking" | "speaking" | "unsupported" | "error";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike> & { length: number };
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function speechSupported() {
  if (typeof window === "undefined") return false;
  return Boolean(getSpeechRecognitionConstructor()) && "speechSynthesis" in window;
}

export function createSpeechRecognition() {
  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = "en-GB";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}

export function speakText(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return () => undefined;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanForSpeech(text));
  utterance.lang = "en-GB";
  utterance.rate = 1.02;
  utterance.pitch = 1;

  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((voice) => /en-GB/i.test(voice.lang) && /male|daniel|arthur|thomas/i.test(voice.name))
    ?? voices.find((voice) => /en-GB/i.test(voice.lang))
    ?? voices.find((voice) => /^en/i.test(voice.lang));
  if (preferred) utterance.voice = preferred;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnd?.();
  };

  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);

  return () => {
    finished = true;
    window.speechSynthesis.cancel();
  };
}

export function cleanForSpeech(text: string) {
  return text
    .replace(/^[\s*-]+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function voiceStatusLabel(state: VoiceSessionState) {
  switch (state) {
    case "listening":
      return "Listening — talk to Blake";
    case "thinking":
      return "Blake is thinking…";
    case "speaking":
      return "Blake is talking";
    case "unsupported":
      return "Voice needs Safari or Chrome on this phone";
    case "error":
      return "Mic issue — tap to try again";
    default:
      return "Put the phone by the job and talk with Blake";
  }
}
