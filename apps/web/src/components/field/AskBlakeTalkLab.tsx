"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Mic, MicOff } from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/field/BlakeCharacter";
import {
  accentGreetingLine,
  accentLockLine,
  BLAKE_VOICE_ACCENT_LABELS,
  BLAKE_VOICE_ACCENTS,
  readStoredBlakeVoiceAccent,
  storeBlakeVoiceAccent,
  type BlakeVoiceAccent,
} from "@/lib/field/ask-blake-voice-accent";

type LabState = "idle" | "connecting" | "live" | "unsupported" | "error";

type AskBlakeTalkLabProps = {
  realtimePath?: string;
  /** App mode hides the debug log and sandbox wording. */
  variant?: "lab" | "app";
};

const FRAME_MS = 4500;
const FRAME_MAX_EDGE = 960;
const FRAME_QUALITY = 0.62;

/**
 * ChatGPT-style hands-free call via OpenAI Realtime WebRTC.
 * Optional live camera frames so Blake can see the job while you talk.
 */
export function AskBlakeTalkLab({
  realtimePath = "/api/field/ask-blake/realtime-session",
  variant = "lab",
}: AskBlakeTalkLabProps) {
  const isLab = variant === "lab";
  const [supported, setSupported] = useState(true);
  const [state, setState] = useState<LabState>("idle");
  const [cameraOn, setCameraOn] = useState(false);
  const [accent, setAccent] = useState<BlakeVoiceAccent>("scottish");
  const [heard, setHeard] = useState("");
  const [blakeSaid, setBlakeSaid] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("Pick a voice, then Start call — talk naturally.");
  const [log, setLog] = useState<string[]>([]);
  const [buildTag] = useState("realtime-voice-picker-v1");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const accentRef = useRef<BlakeVoiceAccent>(accent);

  function note(message: string) {
    const stamp = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLog((current) => [`${stamp} · ${message}`, ...current].slice(0, 16));
  }

  useEffect(() => {
    const stored = readStoredBlakeVoiceAccent();
    setAccent(stored);
    accentRef.current = stored;
  }, []);

  useEffect(() => {
    accentRef.current = accent;
  }, [accent]);

  useEffect(() => {
    const ok = typeof window !== "undefined"
      && !!navigator.mediaDevices?.getUserMedia
      && typeof RTCPeerConnection !== "undefined";
    setSupported(ok);
    if (!ok) setState("unsupported");
    note(isLab ? `Talk lab ${buildTag}` : `Ask Blake live ${buildTag}`);
    return () => {
      void stopCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildTag, isLab]);

  function chooseAccent(next: BlakeVoiceAccent) {
    if (state === "live" || state === "connecting") return;
    setAccent(next);
    storeBlakeVoiceAccent(next);
    setHint(`${BLAKE_VOICE_ACCENT_LABELS[next]} voice selected — Start call to try it.`);
    note(`Voice set to ${BLAKE_VOICE_ACCENT_LABELS[next]}.`);
  }

  function stopTracks(stream: MediaStream | null) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
    }
  }

  function stopFrameLoop() {
    if (frameTimerRef.current != null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
  }

  async function stopCall() {
    activeRef.current = false;
    stopFrameLoop();
    try {
      dcRef.current?.close();
    } catch {
      // ignore
    }
    dcRef.current = null;
    try {
      pcRef.current?.close();
    } catch {
      // ignore
    }
    pcRef.current = null;
    stopTracks(micStreamRef.current);
    micStreamRef.current = null;
    stopTracks(camStreamRef.current);
    camStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
    setState(supported ? "idle" : "unsupported");
    setHint("Pick a voice, then Start call — talk naturally.");
  }

  function sendEvent(payload: Record<string, unknown>) {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify(payload));
  }

  function captureAndSendFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth < 16) return;
    const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", FRAME_QUALITY);
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: dataUrl,
          },
          {
            type: "input_text",
            text: "Live site camera frame — use this with what I’m saying.",
          },
        ],
      },
    });
    note("Sent live camera frame to Blake.");
  }

  function startFrameLoop() {
    stopFrameLoop();
    captureAndSendFrame();
    frameTimerRef.current = window.setInterval(() => {
      if (!activeRef.current) return;
      captureAndSendFrame();
    }, FRAME_MS);
  }

  async function enableCamera() {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      stopTracks(camStreamRef.current);
      camStreamRef.current = cam;
      if (videoRef.current) {
        videoRef.current.srcObject = cam;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
      note("Camera on — Blake gets live frames while you talk.");
      if (activeRef.current && dcRef.current?.readyState === "open") {
        startFrameLoop();
      }
    } catch {
      setError("Camera blocked — allow camera, or keep talking without video.");
      note("Camera permission blocked.");
      setCameraOn(false);
    }
  }

  function disableCamera() {
    stopFrameLoop();
    stopTracks(camStreamRef.current);
    camStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    note("Camera off.");
  }

  async function startCall() {
    if (!supported || activeRef.current) return;
    setError("");
    setHeard("");
    setBlakeSaid("");
    setState("connecting");
    setHint("Connecting hands-free call…");
    note(`Minting Realtime session (${BLAKE_VOICE_ACCENT_LABELS[accentRef.current]})…`);
    activeRef.current = true;

    try {
      const tokenResponse = await fetch(realtimePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accent: accentRef.current }),
      });
      const tokenBody = (await tokenResponse.json().catch(() => ({}))) as {
        clientSecret?: string;
        error?: string;
        build?: string;
        accent?: string;
        voice?: string;
      };
      if (!tokenResponse.ok || !tokenBody.clientSecret) {
        throw new Error(tokenBody.error || "Couldn’t start Realtime session.");
      }
      note(`Session ready (${tokenBody.build || "realtime"} · ${tokenBody.accent || accentRef.current} · ${tokenBody.voice || "voice"}).`);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      if (!remoteAudioRef.current) {
        remoteAudioRef.current = new Audio();
        remoteAudioRef.current.autoplay = true;
        remoteAudioRef.current.setAttribute("playsinline", "true");
      }
      pc.ontrack = (event) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0] ?? null;
          void remoteAudioRef.current.play().catch(() => undefined);
        }
      };

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = mic;
      for (const track of mic.getAudioTracks()) {
        pc.addTrack(track, mic);
      }
      note("Mic attached.");

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        note("Data channel open — VAD on (hands-free).");
        const callAccent = accentRef.current;
        sendEvent({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: accentLockLine(callAccent),
          },
        });
        sendEvent({
          type: "response.create",
          response: {
            instructions: accentGreetingLine(callAccent),
          },
        });
        setState("live");
        setHint(`Call live · ${BLAKE_VOICE_ACCENT_LABELS[callAccent]} — just talk.`);
        if (cameraOn) startFrameLoop();
      });
      dc.addEventListener("message", (event) => {
        let payload: {
          type?: string;
          transcript?: string;
          delta?: string;
          error?: { message?: string };
        } = {};
        try {
          payload = JSON.parse(String(event.data)) as typeof payload;
        } catch {
          return;
        }
        const type = payload.type ?? "";
        if (type === "conversation.item.input_audio_transcription.completed" && payload.transcript) {
          setHeard(payload.transcript);
          note(`You: ${payload.transcript.slice(0, 80)}`);
        }
        if (type === "response.audio_transcript.delta" && payload.delta) {
          setBlakeSaid((current) => `${current}${payload.delta}`);
        }
        if (type === "response.audio_transcript.done" || type === "response.done") {
          // keep last transcript on screen
        }
        if (type === "input_audio_buffer.speech_started") {
          setBlakeSaid("");
          setHint("Hearing you…");
        }
        if (type === "input_audio_buffer.speech_stopped") {
          setHint("Blake is answering…");
        }
        if (type === "error") {
          const message = payload.error?.message || "Realtime error";
          setError(message);
          note(`Error: ${message}`);
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenBody.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp ?? "",
      });
      if (!sdpResponse.ok) {
        throw new Error(`WebRTC handshake failed (${sdpResponse.status}).`);
      }
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      note("WebRTC connected.");
      setState("live");
      setHint(`Call live · ${BLAKE_VOICE_ACCENT_LABELS[accentRef.current]} — optional camera so Blake can see.`);
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : "Couldn’t start call.";
      setError(message);
      note(`Start failed: ${message}`);
      activeRef.current = false;
      await stopCall();
      setState("error");
    }
  }

  async function toggleCall() {
    if (state === "live" || state === "connecting") {
      note("Call ended.");
      await stopCall();
      return;
    }
    await startCall();
  }

  async function toggleCamera() {
    if (cameraOn) {
      disableCamera();
      return;
    }
    await enableCamera();
  }

  const mood: BlakeMood =
    state === "live" ? "guide"
      : state === "connecting" ? "thinking"
        : state === "error" || state === "unsupported" ? "alert"
          : "idle";

  return (
    <section className="ask-blake-voice talk-lab" aria-label="Talk lab">
      <div className={`ask-blake-voice-stage is-${state}`}>
        <BlakeCharacter mood={mood} size="hero" />
        <p className="ask-blake-voice-status">
          {state === "live" ? "Live — hands-free"
            : state === "connecting" ? "Connecting…"
              : state === "unsupported" ? "This phone can’t run live call"
                : state === "error" ? "Call issue"
                  : "Talk with Blake"}
        </p>
        <p className="ask-blake-voice-hint muted">{hint}</p>
        {isLab ? <p className="talk-lab-build muted">Build {buildTag}</p> : null}

        <div className="blake-voice-picker" role="group" aria-label="Blake voice accent">
          {BLAKE_VOICE_ACCENTS.map((option) => (
            <button
              key={option}
              type="button"
              className={accent === option ? "is-active" : undefined}
              disabled={state === "live" || state === "connecting"}
              onClick={() => chooseAccent(option)}
            >
              {BLAKE_VOICE_ACCENT_LABELS[option]}
            </button>
          ))}
        </div>

        <div className="talk-lab-video-wrap">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} className="talk-lab-video" playsInline muted autoPlay />
          <canvas ref={canvasRef} className="talk-lab-canvas" aria-hidden="true" />
          {!cameraOn ? (
            <p className="talk-lab-video-placeholder muted">Camera off — turn on so Blake can see the job</p>
          ) : null}
        </div>

        {heard ? <p className="ask-blake-voice-heard">You: {heard}</p> : null}
        {blakeSaid ? <p className="ask-blake-voice-reply">{blakeSaid}</p> : null}
      </div>

      {error ? <div className="feedback error">{error}</div> : null}

      <div className="ask-blake-voice-actions">
        <button
          type="button"
          className={`ask-blake-voice-btn${state === "live" || state === "connecting" ? " is-live" : ""}`}
          onClick={() => {
            void toggleCall();
          }}
          disabled={!supported || state === "unsupported" || state === "connecting"}
        >
          {state === "live" || state === "connecting" ? <MicOff size={22} /> : <Mic size={22} />}
          <span>
            {state === "connecting" ? "Connecting…"
              : state === "live" ? "End call"
                : "Start call"}
          </span>
        </button>
        <button
          type="button"
          className={`ask-blake-voice-send${cameraOn ? " is-primary-done" : ""}`}
          onClick={() => {
            void toggleCamera();
          }}
          disabled={state === "unsupported"}
        >
          {cameraOn ? <CameraOff size={18} /> : <Camera size={18} />}
          <span>{cameraOn ? "Camera off" : "Camera on"}</span>
        </button>
      </div>

      <p className="ask-blake-voice-hint muted">
        Speak, pause, Blake answers, keep talking — both hands free. Turn camera on so Blake can see the job.
      </p>

      {isLab ? (
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
      ) : null}
    </section>
  );
}
