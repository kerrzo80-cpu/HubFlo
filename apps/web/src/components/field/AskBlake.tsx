"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, SendHorizontal, X } from "lucide-react";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import type { AskBlakeJobContext, AskBlakeMessage } from "@/lib/field/ask-blake";

type AskBlakeChatProps = {
  job?: AskBlakeJobContext | null;
  apiPath?: string;
};

export function AskBlakeChat({ job = null, apiPath = "/api/field/ask-blake" }: AskBlakeChatProps) {
  const [messages, setMessages] = useState<AskBlakeMessage[]>([
    {
      role: "assistant",
      text: job?.jobRef
        ? `Ask me anything about ${job.jobRef}${job.costCentre ? ` · ${job.costCentre}` : ""}. Describe the fault or attach a photo.`
        : "Ask Blake — describe the fault, or attach a site photo. I’ll give likely cause, checks and next steps.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!busy && messages.length <= 1) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  async function onPickImage(file: File | null) {
    if (!file) return;
    const type = (file.type || "").toLowerCase();
    const name = file.name.toLowerCase();
    const looksLikeImage =
      type.startsWith("image/")
      || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(name)
      || type === "";
    if (!looksLikeImage) {
      setError("Attach a photo from your library, or take one.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Keep photos under 12MB for this pilot.");
      return;
    }
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setImageDataUrl(dataUrl);
      setError("");
    } catch {
      setError("Could not read that photo. Try another image or take a new one.");
    }
  }

  function readImageAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (!result) reject(new Error("empty"));
        else resolve(result);
      };
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  async function send(message: string) {
    const trimmed = message.trim();
    if ((!trimmed && !imageDataUrl) || busy) return;

    const userText = trimmed || "What do you see in this photo, and what should I check next?";
    const nextHistory = messages.filter((item) => item.role === "user" || item.role === "assistant");
    const userMessage: AskBlakeMessage = { role: "user", text: userText, hasImage: Boolean(imageDataUrl) };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setBusy(true);
    setError("");
    setWarning("");

    try {
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          imageDataUrl: imageDataUrl || undefined,
          history: nextHistory.slice(-10),
          job,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        warning?: string;
        provider?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Ask Blake could not reply.");
      if (!body.reply?.trim()) throw new Error("Ask Blake returned an empty reply.");
      setMessages((current) => [...current, { role: "assistant", text: body.reply!.trim() }]);
      if (body.warning) setWarning(body.warning);
      setImageDataUrl(null);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Ask Blake could not reply.");
      setMessages((current) => current.slice(0, -1));
      setDraft(trimmed);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <section className="ask-blake" aria-label="Ask Blake">
      <div className="ask-blake-thread">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`ask-blake-bubble ${message.role === "assistant" ? "is-blake" : "is-user"}`}
          >
            {message.role === "assistant" ? (
              <span className="ask-blake-avatar">
                <BlakeCharacter
                  mood={index === 0 ? "idle" : "good"}
                  size="sm"
                />
              </span>
            ) : null}
            <div>
              <p>{message.text}</p>
              {message.hasImage ? <span className="ask-blake-photo-tag">Photo attached</span> : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="ask-blake-bubble is-blake">
            <span className="ask-blake-avatar">
              <BlakeCharacter mood="thinking" size="sm" />
            </span>
            <p className="muted">Blake is checking that…</p>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {warning ? <div className="feedback">{warning}</div> : null}
      {error ? <div className="feedback error">{error}</div> : null}

      {imageDataUrl ? (
        <div className="ask-blake-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageDataUrl} alt="Attached site photo" />
          <button type="button" aria-label="Remove photo" onClick={() => setImageDataUrl(null)}>
            <X size={16} />
          </button>
        </div>
      ) : null}

      <form className="ask-blake-composer" onSubmit={onSubmit}>
        {/* No capture attr — lets engineers pick from the photo library. */}
        <input
          ref={libraryRef}
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          onChange={(event) => {
            void onPickImage(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        {/* Separate camera capture for site photos. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            void onPickImage(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        <div className="ask-blake-attach">
          <button
            type="button"
            className="ask-blake-icon-btn"
            aria-label="Upload photo"
            title="Upload photo"
            onClick={() => libraryRef.current?.click()}
            disabled={busy}
          >
            <ImagePlus size={18} />
          </button>
          <button
            type="button"
            className="ask-blake-icon-btn"
            aria-label="Take photo"
            title="Take photo"
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
          >
            <Camera size={18} />
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={job ? "Ask about this job…" : "Ask Blake…"}
          rows={2}
          disabled={busy}
        />
        <button
          type="submit"
          className="ask-blake-icon-btn is-send"
          aria-label="Send"
          disabled={busy || (!draft.trim() && !imageDataUrl)}
        >
          <SendHorizontal size={18} />
        </button>
      </form>
    </section>
  );
}
