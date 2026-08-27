"use client";

import { ArrowLeft, Gauge, Mic, PhoneOff, Sparkles, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  BLAKE_VOICE_ACCENT_LABELS,
  BLAKE_VOICE_ACCENTS,
  readStoredBlakeVoiceAccent,
  storeBlakeVoiceAccent,
  type BlakeVoiceAccent,
} from "@/lib/field/ask-blake-voice-accent";

import styles from "./drive.module.css";

type DriveState = "idle" | "connecting" | "listening" | "recording" | "thinking" | "speaking" | "error" | "unsupported";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  action?: { id: string; title: string; detail: string; confirmLabel: string; kind?: string };
};
type Chat = { id: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[] };
type AssistantResult = {
  reply?: string;
  error?: string;
  action?: { id: string; title: string; detail: string; confirmLabel: string; kind?: string };
};
type WakeLockSentinelLike = { release: () => Promise<void> };
type WebkitWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

const SILENCE_MS = 900;
const MAX_TURN_MS = 25_000;
const MIN_TURN_MS = 450;
const MIN_BLOB_BYTES = 900;

function messageId() {
  return `drive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stateLabel(state: DriveState) {
  if (state === "connecting") return "Starting Standard Voice…";
  if (state === "listening") return "Listening";
  if (state === "recording") return "Listening…";
  if (state === "thinking") return "Ayla is working…";
  if (state === "speaking") return "Ayla is speaking";
  if (state === "unsupported") return "Standard Voice isn’t supported on this browser";
  if (state === "error") return "Voice issue";
  return "Standard Voice";
}

function preferredMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function extensionForMime(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function localVoice(accent: BlakeVoiceAccent) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return undefined;
  if (accent === "american") {
    return voices.find((voice) => /^en-US$/i.test(voice.lang))
      || voices.find((voice) => /^en[-_]US/i.test(voice.lang));
  }
  if (accent === "scottish") {
    return voices.find((voice) => /scot|scotland/i.test(`${voice.name} ${voice.lang}`))
      || voices.find((voice) => /^en-GB$/i.test(voice.lang))
      || voices.find((voice) => /^en[-_]GB/i.test(voice.lang));
  }
  return voices.find((voice) => /^en-GB$/i.test(voice.lang))
    || voices.find((voice) => /^en[-_]GB/i.test(voice.lang));
}

export default function BlakeStandardDrivingMode() {
  const [state, setState] = useState<DriveState>("idle");
  const [accent, setAccent] = useState<BlakeVoiceAccent>("scottish");
  const [heard, setHeard] = useState("");
  const [aylaSaid, setAylaSaid] = useState("");
  const [error, setError] = useState("");
  const [conversationTitle, setConversationTitle] = useState("Driving conversation");

  const micRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const chatRef = useRef<Chat | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const activeRef = useRef(false);
  const processingRef = useRef(false);
  const speakingRef = useRef(false);
  const recordingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const lastVoiceAtRef = useRef(0);
  const speechFramesRef = useRef(0);
  const noiseFloorRef = useRef(0.012);
  const speechSequenceRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    setAccent(readStoredBlakeVoiceAccent());
    const browser = typeof window !== "undefined" ? window as WebkitWindow : null;
    const supported = Boolean(
      browser
      && navigator.mediaDevices
      && typeof MediaRecorder !== "undefined"
      && (browser.AudioContext || browser.webkitAudioContext),
    );
    if (!supported) setState("unsupported");
    return () => { void stopCall(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseAccent(next: BlakeVoiceAccent) {
    if (activeRef.current) return;
    setAccent(next);
    storeBlakeVoiceAccent(next);
  }

  function stopTracks(stream: MediaStream | null) {
    for (const track of stream?.getTracks() ?? []) {
      try { track.stop(); } catch { /* ignore */ }
    }
  }

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
      wakeLockRef.current = await nav.wakeLock?.request("screen") ?? null;
    } catch {
      wakeLockRef.current = null;
    }
  }

  async function releaseWakeLock() {
    try { await wakeLockRef.current?.release(); } catch { /* ignore */ }
    wakeLockRef.current = null;
  }

  async function createDrivingChat() {
    if (chatRef.current) return chatRef.current;
    const response = await fetch("/api/blake/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    const payload = await response.json().catch(() => ({})) as { chat?: Chat; error?: string };
    if (!response.ok || !payload.chat) throw new Error(payload.error || "Could not create an Ayla driving conversation.");
    chatRef.current = payload.chat;
    historyRef.current = payload.chat.messages ?? [];
    setConversationTitle(payload.chat.title || "Driving conversation");
    return payload.chat;
  }

  async function saveTurn(userText: string, assistantText: string, action?: AssistantResult["action"]) {
    const chat = chatRef.current;
    if (!chat) return;
    const user: ChatMessage = { id: messageId(), role: "user", text: userText, createdAt: new Date().toISOString() };
    const assistant: ChatMessage = { id: messageId(), role: "assistant", text: assistantText, createdAt: new Date().toISOString(), action };
    historyRef.current = [...historyRef.current, user, assistant].slice(-80);
    const next = { ...chat, messages: historyRef.current, updatedAt: new Date().toISOString() };
    chatRef.current = next;
    const response = await fetch("/api/blake/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: next.id, title: next.title, messages: next.messages }),
    });
    if (response.ok) {
      const payload = await response.json().catch(() => ({})) as { chat?: Chat };
      if (payload.chat) chatRef.current = payload.chat;
    }
  }

  function finishLocalSpeech() {
    speakingRef.current = false;
    processingRef.current = false;
    if (activeRef.current) setState("listening");
  }

  function speakLocal(reply: string) {
    setAylaSaid(reply);
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      finishLocalSpeech();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(reply);
    const voice = localVoice(accent);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || (accent === "american" ? "en-US" : "en-GB");
    utterance.rate = 1.04;
    utterance.pitch = 1;
    utterance.onstart = () => {
      speakingRef.current = true;
      setState("speaking");
    };
    utterance.onend = finishLocalSpeech;
    utterance.onerror = finishLocalSpeech;
    speakingRef.current = true;
    setState("speaking");
    window.speechSynthesis.speak(utterance);
  }

  async function askAyla(text: string, sequence: number) {
    if (!activeRef.current) return;
    setHeard(text);
    setState("thinking");
    setError("");
    const chat = await createDrivingChat();
    const response = await fetch("/api/nexa-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        message: text,
        history: historyRef.current.slice(-40).map((item) => ({ role: item.role, text: item.text })),
        sourceRoute: "/blake/drive",
        sourcePage: "Ayla Standard Driving Mode",
        channel: "web_voice_standard",
        conversationId: chat.id,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const payload = await response.json().catch(() => ({})) as AssistantResult;
    const reply = payload.reply || payload.error || "I couldn’t complete that request reliably.";
    await saveTurn(text, reply, payload.action);
    if (!activeRef.current || sequence !== speechSequenceRef.current) return;
    if (!response.ok && response.status >= 500) setError(reply);
    speakLocal(reply);
  }

  async function transcribeTurn(blob: Blob, durationMs: number) {
    const form = new FormData();
    const mime = blob.type || "audio/webm";
    form.append("audio", blob, `ayla-turn.${extensionForMime(mime)}`);
    form.append("durationMs", String(Math.round(durationMs)));
    const response = await fetch("/api/blake/transcribe", { method: "POST", credentials: "include", body: form });
    const payload = await response.json().catch(() => ({})) as { text?: string; error?: string };
    if (!response.ok) throw new Error(payload.error || "Ayla could not transcribe that voice turn.");
    const text = payload.text?.trim() || "";
    if (!text) {
      processingRef.current = false;
      if (activeRef.current) setState("listening");
      return;
    }
    speechSequenceRef.current += 1;
    await askAyla(text, speechSequenceRef.current);
  }

  function startTurnRecorder() {
    const stream = micRef.current;
    if (!stream || recordingRef.current || processingRef.current || speakingRef.current || !activeRef.current) return;
    const mimeType = preferredMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recordingRef.current = true;
    recordingStartedAtRef.current = performance.now();
    lastVoiceAtRef.current = performance.now();
    setState("recording");
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
    recorder.onerror = () => {
      recordingRef.current = false;
      processingRef.current = false;
      setError("The microphone recording stopped unexpectedly.");
      if (activeRef.current) setState("listening");
    };
    recorder.onstop = () => {
      recordingRef.current = false;
      const durationMs = performance.now() - recordingStartedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      chunksRef.current = [];
      if (!activeRef.current) return;
      if (durationMs < MIN_TURN_MS || blob.size < MIN_BLOB_BYTES) {
        processingRef.current = false;
        setState("listening");
        return;
      }
      setState("thinking");
      void transcribeTurn(blob, durationMs).catch((reason) => {
        const message = reason instanceof Error ? reason.message : "Ayla could not process that voice turn.";
        setError(message);
        processingRef.current = false;
        if (activeRef.current) setState("listening");
      });
    };
    recorder.start(250);
  }

  function stopTurnRecorder() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive" || !recordingRef.current) return;
    processingRef.current = true;
    try { recorder.stop(); } catch {
      processingRef.current = false;
      recordingRef.current = false;
    }
  }

  function startLevelMonitor() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!activeRef.current || !analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();
      if (!recordingRef.current && !processingRef.current && !speakingRef.current) {
        if (rms < 0.08) noiseFloorRef.current = (noiseFloorRef.current * 0.985) + (rms * 0.015);
        const startThreshold = Math.max(0.025, noiseFloorRef.current * 2.8);
        if (rms >= startThreshold) speechFramesRef.current += 1;
        else speechFramesRef.current = 0;
        if (speechFramesRef.current >= 3) {
          speechFramesRef.current = 0;
          startTurnRecorder();
        }
      }
      if (recordingRef.current) {
        const voiceThreshold = Math.max(0.018, noiseFloorRef.current * 1.8);
        if (rms >= voiceThreshold) lastVoiceAtRef.current = now;
        const elapsed = now - recordingStartedAtRef.current;
        const quietFor = now - lastVoiceAtRef.current;
        if ((elapsed >= MIN_TURN_MS && quietFor >= SILENCE_MS) || elapsed >= MAX_TURN_MS) stopTurnRecorder();
      }
      animationRef.current = window.requestAnimationFrame(tick);
    };
    animationRef.current = window.requestAnimationFrame(tick);
  }

  async function startCall() {
    if (activeRef.current || state === "unsupported") return;
    setState("connecting");
    setError("");
    setHeard("");
    setAylaSaid("");
    activeRef.current = true;
    processingRef.current = false;
    speechSequenceRef.current = 0;
    try {
      await createDrivingChat();
      await requestWakeLock();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      micRef.current = stream;
      const browser = window as WebkitWindow;
      const AudioContextCtor = browser.AudioContext || browser.webkitAudioContext;
      if (!AudioContextCtor) throw new Error("This browser cannot monitor the microphone for hands-free turns.");
      const context = new AudioContextCtor();
      audioContextRef.current = context;
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      analyserRef.current = analyser;
      noiseFloorRef.current = 0.012;
      startLevelMonitor();
      setState("listening");
      speakLocal("Ayla is live. What do you need?");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Ayla Standard Voice could not start.";
      setError(message);
      await stopCall();
      setState("error");
    }
  }

  async function stopCall() {
    activeRef.current = false;
    processingRef.current = false;
    speakingRef.current = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (animationRef.current !== null && typeof window !== "undefined") window.cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    recordingRef.current = false;
    analyserRef.current = null;
    try { await audioContextRef.current?.close(); } catch { /* ignore */ }
    audioContextRef.current = null;
    stopTracks(micRef.current);
    micRef.current = null;
    await releaseWakeLock();
    if (state !== "unsupported") setState("idle");
  }

  const active = activeRef.current || ["connecting", "listening", "recording", "thinking", "speaking"].includes(state);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/blake" className={styles.back}><ArrowLeft size={20} /> Ayla</a>
        <span className={styles.title}>{conversationTitle}</span>
        <span className={`${styles.liveDot} ${active ? styles.live : ""}`} aria-label={active ? "Live" : "Offline"} />
      </header>
      <section className={styles.stage}>
        <div className={styles.modeBar}>
          <span className={styles.modeActive}><Gauge size={15} /> Standard Voice</span>
          <a href="/blake/drive/premium"><Sparkles size={15} /> Premium Realtime</a>
        </div>
        <div className={`${styles.orb} ${active ? styles.orbLive : ""} ${state === "thinking" ? styles.orbThinking : ""}`}>
          {state === "speaking" ? <Volume2 size={54} /> : <Mic size={54} />}
        </div>
        <h1>{stateLabel(state)}</h1>
        <p className={styles.hint}>
          {active
            ? "Talk naturally. Ayla sends only each finished voice turn for transcription, then your phone reads her answer aloud."
            : "Low-cost hands-free Ayla. Voice is transcribed per turn; Ayla still uses the full Blake tools and conversation."}
        </p>
        {!active ? (
          <div className={styles.voicePicker} aria-label="Local voice accent preference">
            {BLAKE_VOICE_ACCENTS.map((option) => (
              <button key={option} className={option === accent ? styles.voiceSelected : ""} onClick={() => chooseAccent(option)}>
                {BLAKE_VOICE_ACCENT_LABELS[option]}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className={active ? styles.endButton : styles.startButton}
          onClick={() => void (active ? stopCall() : startCall())}
          disabled={state === "unsupported"}
        >
          {active ? <PhoneOff size={25} /> : <Mic size={25} />}
          {active ? "End conversation" : "Start Standard Voice"}
        </button>
        <p className={styles.costNote}>Standard Voice uses low-cost transcription + Luna. Ayla’s spoken reply uses your device voice.</p>
        <div className={styles.transcript} aria-live="polite">
          {heard ? <div><span>You</span><p>{heard}</p></div> : null}
          {aylaSaid ? <div><span>Ayla</span><p>{aylaSaid}</p></div> : null}
          {!heard && !aylaSaid ? <p className={styles.empty}>Your latest exchange will appear here as a backup while Ayla speaks through the car.</p> : null}
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
        <p className={styles.safety}>Use voice while driving. Only interact with the screen when it is safe and legal to do so.</p>
      </section>
    </main>
  );
}
