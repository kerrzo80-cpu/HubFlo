"use client";

import { cleanForSpeech } from "@/lib/field/ask-blake-speech";

export type VoiceSessionState = "idle" | "listening" | "thinking" | "speaking" | "unsupported" | "error";

export { cleanForSpeech };

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
    __blakeVoiceAudio?: HTMLAudioElement;
  }
}

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function speechSupported() {
  if (typeof window === "undefined") return false;
  return Boolean(getSpeechRecognitionConstructor());
}

export function createSpeechRecognition(options?: { continuous?: boolean }) {
  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  // Prefer device language; fall back to UK English for trade wording.
  recognition.lang = (typeof navigator !== "undefined" && navigator.language) || "en-GB";
  recognition.continuous = options?.continuous ?? true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}

function getSharedAudio() {
  if (typeof window === "undefined") return null;
  if (!window.__blakeVoiceAudio) {
    window.__blakeVoiceAudio = new Audio();
    window.__blakeVoiceAudio.setAttribute("playsinline", "true");
    window.__blakeVoiceAudio.preload = "auto";
  }
  return window.__blakeVoiceAudio;
}

export async function ensureMicAccess() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("This phone can’t open the microphone for Ask Blake.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  return stream;
}

export function stopMicStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore
    }
  }
}

/**
 * Must run inside the Start talking tap handler.
 * iOS Safari blocks speech/audio until unlocked by a user gesture.
 */
export async function unlockBlakeVoice() {
  if (typeof window === "undefined") return;

  // Stop any leftover playback before we open the mic.
  stopBlakeAudio();

  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.getVoices();
      const unlock = new SpeechSynthesisUtterance(" ");
      unlock.volume = 0.01;
      unlock.rate = 2;
      unlock.lang = "en-GB";
      window.speechSynthesis.speak(unlock);
      window.setTimeout(() => {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }, 40);
    } catch {
      // ignore
    }
  }

  const audio = getSharedAudio();
  if (!audio) return;
  try {
    audio.src =
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==";
    audio.volume = 0.01;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
    audio.volume = 1;
  } catch {
    // ignore
  }
}

function pickVoice() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => /en-GB/i.test(voice.lang) && /male|daniel|arthur|thomas|rishi/i.test(voice.name))
    ?? voices.find((voice) => /en-GB/i.test(voice.lang))
    ?? voices.find((voice) => /^en/i.test(voice.lang))
    ?? null
  );
}

function speakWithSynthesis(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return () => undefined;
  }

  const spoken = cleanForSpeech(text);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnd?.();
  };

  const speakNow = () => {
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    } catch {
      // ignore
    }

    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = "en-GB";
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);

    // iOS sometimes marks speak() as started but never fires onend if audio is muted/blocked.
    const watchdog = window.setTimeout(() => {
      if (!finished && !window.speechSynthesis.speaking) finish();
    }, Math.min(20000, Math.max(4000, spoken.length * 80)));

    const originalFinish = finish;
    utterance.onend = () => {
      window.clearTimeout(watchdog);
      originalFinish();
    };
    utterance.onerror = () => {
      window.clearTimeout(watchdog);
      originalFinish();
    };
  };

  // Voices can be empty on first call on Safari — wait briefly then speak.
  if (!pickVoice()) {
    window.setTimeout(speakNow, 150);
  } else {
    window.setTimeout(speakNow, 30);
  }

  return () => {
    finished = true;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  };
}

async function speakWithServerAudio(text: string, speakPath: string, onEnd?: () => void) {
  const audio = getSharedAudio();
  if (!audio) throw new Error("No audio element");

  const response = await fetch(speakPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: cleanForSpeech(text) }),
  });
  if (!response.ok) throw new Error(`Speak failed (${response.status})`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("Empty audio");

  const url = URL.createObjectURL(blob);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    URL.revokeObjectURL(url);
    onEnd?.();
  };

  audio.onended = finish;
  audio.onerror = finish;
  audio.src = url;
  audio.volume = 1;
  await audio.play();

  return () => {
    finished = true;
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      // ignore
    }
    URL.revokeObjectURL(url);
  };
}

/**
 * Prefer server TTS (works after unlock on iOS). Fall back to device speechSynthesis.
 */
export async function speakBlakeReply(
  text: string,
  options?: { speakPath?: string; onEnd?: () => void },
) {
  const speakPath = options?.speakPath ?? "/api/field/ask-blake/speak";
  const onEnd = options?.onEnd;

  try {
    return await speakWithServerAudio(text, speakPath, onEnd);
  } catch {
    return speakWithSynthesis(text, onEnd);
  }
}

/** @deprecated Prefer speakBlakeReply */
export function speakText(text: string, onEnd?: () => void) {
  return speakWithSynthesis(text, onEnd);
}

export function stopBlakeAudio() {
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
  const audio = window.__blakeVoiceAudio;
  if (!audio) return;
  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } catch {
    // ignore
  }
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
