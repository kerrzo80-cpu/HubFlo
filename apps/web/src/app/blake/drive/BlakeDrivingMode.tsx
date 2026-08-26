"use client";

import { ArrowLeft, Mic, PhoneOff, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  BLAKE_VOICE_ACCENT_LABELS,
  BLAKE_VOICE_ACCENTS,
  readStoredBlakeVoiceAccent,
  storeBlakeVoiceAccent,
  type BlakeVoiceAccent,
} from "@/lib/field/ask-blake-voice-accent";

import styles from "./drive.module.css";

type DriveState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error" | "unsupported";
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

type RealtimeEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  error?: { message?: string };
};

function messageId() {
  return `drive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stateLabel(state: DriveState) {
  if (state === "connecting") return "Connecting…";
  if (state === "listening") return "Listening";
  if (state === "thinking") return "Working in NeXa…";
  if (state === "speaking") return "Ayla is speaking";
  if (state === "unsupported") return "Live voice isn’t supported on this browser";
  if (state === "error") return "Call issue";
  return "Ready to drive";
}

export default function BlakeDrivingMode() {
  const [state, setState] = useState<DriveState>("idle");
  const [accent, setAccent] = useState<BlakeVoiceAccent>("scottish");
  const [heard, setHeard] = useState("");
  const [blakeSaid, setBlakeSaid] = useState("");
  const [error, setError] = useState("");
  const [conversationTitle, setConversationTitle] = useState("Driving conversation");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatRef = useRef<Chat | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const activeRef = useRef(false);
  const speechSequenceRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    setAccent(readStoredBlakeVoiceAccent());
    const supported = typeof window !== "undefined"
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof RTCPeerConnection !== "undefined";
    if (!supported) setState("unsupported");
    return () => {
      void stopCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseAccent(next: BlakeVoiceAccent) {
    if (activeRef.current) return;
    setAccent(next);
    storeBlakeVoiceAccent(next);
  }

  function sendEvent(payload: Record<string, unknown>) {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify(payload));
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
    if (!response.ok || !payload.chat) throw new Error(payload.error || "Could not create a Ayla driving conversation.");
    chatRef.current = payload.chat;
    historyRef.current = payload.chat.messages ?? [];
    setConversationTitle(payload.chat.title || "Driving conversation");
    return payload.chat;
  }

  async function saveTurn(userText: string, assistantText: string, action?: AssistantResult["action"]) {
    const chat = chatRef.current;
    if (!chat) return;
    const user: ChatMessage = { id: messageId(), role: "user", text: userText, createdAt: new Date().toISOString() };
    const assistant: ChatMessage = {
      id: messageId(), role: "assistant", text: assistantText, createdAt: new Date().toISOString(), action,
    };
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

  function speak(reply: string) {
    setBlakeSaid(reply);
    setState("speaking");
    sendEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        max_output_tokens: 1600,
        instructions: [
          "Speak the following Ayla response naturally and faithfully.",
          "Do not add facts, remove figures, change names, alter references, or change whether confirmation is required.",
          "For long lists, speak clearly and use short pauses.",
          "AYLA RESPONSE:",
          reply,
        ].join("\n"),
      },
    });
  }

  async function askNexa(text: string, sequence: number) {
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
        sourcePage: "Ayla Driving Mode",
        channel: "web_voice",
        conversationId: chat.id,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const payload = await response.json().catch(() => ({})) as AssistantResult;
    const reply = payload.reply || payload.error || "I couldn’t complete that request reliably.";
    await saveTurn(text, reply, payload.action);
    if (!activeRef.current) return;
    // If the user has already started another turn, preserve this result in history but do not talk over them.
    if (sequence !== speechSequenceRef.current) return;
    if (!response.ok && response.status >= 500) setError(reply);
    speak(reply);
  }

  function enqueueTranscript(text: string, sequence: number) {
    const cleaned = text.trim();
    if (!cleaned) return;
    queueRef.current = queueRef.current
      .then(() => askNexa(cleaned, sequence))
      .catch((reason) => {
        const message = reason instanceof Error ? reason.message : "Ayla could not process that turn.";
        setError(message);
        if (activeRef.current && sequence === speechSequenceRef.current) speak(message);
      });
  }

  async function startCall() {
    if (activeRef.current || state === "unsupported") return;
    setState("connecting");
    setError("");
    setHeard("");
    setBlakeSaid("");
    activeRef.current = true;
    speechSequenceRef.current = 0;
    queueRef.current = Promise.resolve();

    try {
      await createDrivingChat();
      await requestWakeLock();
      const tokenResponse = await fetch("/api/blake/realtime-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accent }),
      });
      const token = await tokenResponse.json().catch(() => ({})) as {
        clientSecret?: string; error?: string; model?: string; voice?: string;
      };
      if (!tokenResponse.ok || !token.clientSecret) throw new Error(token.error || "Could not start Ayla live voice.");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.autoplay = true;
        audioRef.current.setAttribute("playsinline", "true");
      }
      pc.ontrack = (event) => {
        if (!audioRef.current) return;
        audioRef.current.srcObject = event.streams[0] ?? null;
        void audioRef.current.play().catch(() => undefined);
      };

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      micRef.current = mic;
      for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        setState("listening");
        sendEvent({
          type: "response.create",
          response: {
            output_modalities: ["audio"],
            instructions: "Say: ‘Ayla is live. What do you need?’ Keep it to that one short sentence.",
          },
        });
      });
      dc.addEventListener("message", (event) => {
        let payload: RealtimeEvent = {};
        try { payload = JSON.parse(String(event.data)) as RealtimeEvent; } catch { return; }
        const type = payload.type ?? "";
        if (type === "input_audio_buffer.speech_started") {
          speechSequenceRef.current += 1;
          setState("listening");
          setBlakeSaid("");
          sendEvent({ type: "response.cancel" });
          sendEvent({ type: "output_audio_buffer.clear" });
        }
        if (type === "input_audio_buffer.speech_stopped") setState("thinking");
        if (type === "conversation.item.input_audio_transcription.completed" && payload.transcript) {
          const sequence = speechSequenceRef.current || 1;
          if (!speechSequenceRef.current) speechSequenceRef.current = sequence;
          enqueueTranscript(payload.transcript, sequence);
        }
        if ((type === "response.audio_transcript.delta" || type === "response.output_audio_transcript.delta") && payload.delta) {
          // The authoritative displayed answer is the NeXa orchestrator reply; this event only proves audio is flowing.
          setState("speaking");
        }
        if (type === "output_audio_buffer.started") setState("speaking");
        if (type === "output_audio_buffer.stopped") setState("listening");
        if (type === "error") {
          const message = payload.error?.message || "Realtime voice error.";
          if (!/cancel/i.test(message)) setError(message);
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp ?? "",
      });
      if (!sdpResponse.ok) throw new Error(`Voice connection failed (${sdpResponse.status}).`);
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      setState("listening");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Ayla Driving Mode could not start.";
      setError(message);
      await stopCall();
      setState("error");
    }
  }

  async function stopCall() {
    activeRef.current = false;
    try { dcRef.current?.close(); } catch { /* ignore */ }
    dcRef.current = null;
    try { pcRef.current?.close(); } catch { /* ignore */ }
    pcRef.current = null;
    stopTracks(micRef.current);
    micRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    await releaseWakeLock();
    if (state !== "unsupported") setState("idle");
  }

  const active = activeRef.current || ["connecting", "listening", "thinking", "speaking"].includes(state);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/blake" className={styles.back}><ArrowLeft size={20} /> Ayla</a>
        <span className={styles.title}>{conversationTitle}</span>
        <span className={`${styles.liveDot} ${active ? styles.live : ""}`} aria-label={active ? "Live" : "Offline"} />
      </header>

      <section className={styles.stage}>
        <div className={`${styles.orb} ${active ? styles.orbLive : ""} ${state === "thinking" ? styles.orbThinking : ""}`}>
          {state === "speaking" ? <Volume2 size={54} /> : <Mic size={54} />}
        </div>
        <h1>{stateLabel(state)}</h1>
        <p className={styles.hint}>
          {active ? "Keep talking naturally. Interrupt Ayla whenever you need to." : "One tap starts a hands-free Ayla conversation through your car audio."}
        </p>

        {!active ? (
          <div className={styles.voicePicker} aria-label="Voice accent">
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
          {active ? "End conversation" : "Start Driving Mode"}
        </button>

        <div className={styles.transcript} aria-live="polite">
          {heard ? <div><span>You</span><p>{heard}</p></div> : null}
          {blakeSaid ? <div><span>Ayla</span><p>{blakeSaid}</p></div> : null}
          {!heard && !blakeSaid ? <p className={styles.empty}>Your latest exchange will appear here as a backup while Ayla speaks through the car.</p> : null}
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        <p className={styles.safety}>Use voice while driving. Only interact with the screen when it is safe and legal to do so.</p>
      </section>
    </main>
  );
}
