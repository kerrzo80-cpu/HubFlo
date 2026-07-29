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
  // Prefer real mic recording (works on iPhone). SpeechRecognition alone is unreliable there.
  return Boolean(
    navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function"
    && typeof window.MediaRecorder === "function",
  );
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

export function pickRecorderMimeType() {
  if (typeof window === "undefined" || typeof window.MediaRecorder !== "function") return "";
  const candidates = [
    "audio/mp4",
    "audio/aac",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  }) ?? "";
}

export type ActiveVoiceRecorder = {
  stop: () => Promise<Blob>;
  mimeType: string;
};

export function startVoiceRecorder(stream: MediaStream): ActiveVoiceRecorder {
  const mimeType = pickRecorderMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  try {
    recorder.start(250);
  } catch {
    recorder.start();
  }

  return {
    mimeType: recorder.mimeType || mimeType || "audio/webm",
    stop: () =>
      new Promise<Blob>((resolve) => {
        const finish = () => {
          const type = recorder.mimeType || mimeType || "audio/webm";
          resolve(new Blob(chunks, { type }));
        };
        if (recorder.state === "inactive") {
          finish();
          return;
        }
        recorder.onstop = finish;
        try {
          recorder.requestData?.();
        } catch {
          // ignore
        }
        try {
          recorder.stop();
        } catch {
          finish();
        }
      }),
  };
}

export type MicLevelMonitor = {
  stop: () => void;
};

/**
 * Returns 0–1 RMS mic level. Use for “is it hearing me?” feedback and silence detection.
 */
export function startMicLevelMonitor(
  stream: MediaStream,
  onLevel: (level: number) => void,
): MicLevelMonitor {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return { stop: () => undefined };
  }

  const context = new AudioCtx();
  void context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.35;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const sample = ((data[index] ?? 128) - 128) / 128;
      sum += sample * sample;
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
    raf = window.requestAnimationFrame(tick);
  };
  tick();

  return {
    stop: () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
      try {
        source.disconnect();
      } catch {
        // ignore
      }
      void context.close();
    },
  };
}

export async function transcribeBlakeAudio(blob: Blob, transcribePath: string) {
  const form = new FormData();
  const type = blob.type || "audio/webm";
  const extension =
    type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a"
      : type.includes("mpeg") || type.includes("mp3") ? "mp3"
        : type.includes("wav") ? "wav"
          : type.includes("ogg") ? "ogg"
            : "webm";
  form.append("audio", blob, `blake-voice.${extension}`);
  const response = await fetch(transcribePath, { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!response.ok || !body.text?.trim()) {
    throw new Error(body.error ?? "Didn’t catch that — try again.");
  }
  return body.text.trim();
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
      return "This phone can’t record for Ask Blake";
    case "error":
      return "Mic issue — tap to try again";
    default:
      return "Put the phone by the job and talk with Blake";
  }
}
