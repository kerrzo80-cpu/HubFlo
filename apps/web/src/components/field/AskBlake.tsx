"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, SendHorizontal, X } from "lucide-react";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import {
  ASK_BLAKE_MAX_PHOTOS,
  type AskBlakeJobContext,
  type AskBlakeMessage,
} from "@/lib/field/ask-blake";

type AskBlakeChatProps = {
  job?: AskBlakeJobContext | null;
  apiPath?: string;
};

export function AskBlakeChat({ job = null, apiPath = "/api/field/ask-blake" }: AskBlakeChatProps) {
  const [messages, setMessages] = useState<AskBlakeMessage[]>([
    {
      role: "assistant",
      text: job?.jobRef
        ? `Ask me anything about ${job.jobRef}${job.costCentre ? ` · ${job.costCentre}` : ""}. Describe the fault or attach photos.`
        : "Ask Blake — describe the fault, or attach site photos. I’ll give likely cause, checks and next steps.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
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

  async function onPickImages(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;

    const remaining = ASK_BLAKE_MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setError(`You can attach up to ${ASK_BLAKE_MAX_PHOTOS} photos.`);
      return;
    }

    const selected = files.slice(0, remaining);
    const next: string[] = [];
    for (const file of selected) {
      const type = (file.type || "").toLowerCase();
      const name = file.name.toLowerCase();
      const looksLikeImage =
        type.startsWith("image/")
        || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(name)
        || type === "";
      if (!looksLikeImage) {
        setError("Attach photos from your library, or take them.");
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        setError("Keep each photo under 12MB for this pilot.");
        return;
      }
      try {
        next.push(await readImageAsDataUrl(file));
      } catch {
        setError("Could not read one of those photos. Try another image.");
        return;
      }
    }

    setPhotos((current) => [...current, ...next].slice(0, ASK_BLAKE_MAX_PHOTOS));
    setError(files.length > remaining ? `Added ${remaining} — max ${ASK_BLAKE_MAX_PHOTOS} photos.` : "");
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

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function send(message: string) {
    const trimmed = message.trim();
    if ((!trimmed && !photos.length) || busy) return;

    const userText = trimmed || (
      photos.length > 1
        ? "What do you see in these photos, and what should I check next?"
        : "What do you see in this photo, and what should I check next?"
    );
    const attached = [...photos];
    const nextHistory = messages.filter((item) => item.role === "user" || item.role === "assistant");
    const userMessage: AskBlakeMessage = {
      role: "user",
      text: userText,
      hasImage: attached.length > 0,
      imageCount: attached.length,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setPhotos([]);
    setBusy(true);
    setError("");
    setWarning("");

    try {
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          imageDataUrls: attached,
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
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Ask Blake could not reply.");
      setMessages((current) => current.slice(0, -1));
      setDraft(trimmed);
      setPhotos(attached);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const canAddMore = photos.length < ASK_BLAKE_MAX_PHOTOS;

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
              {message.hasImage ? (
                <span className="ask-blake-photo-tag">
                  {(message.imageCount ?? 1) > 1
                    ? `${message.imageCount} photos attached`
                    : "Photo attached"}
                </span>
              ) : null}
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

      {photos.length ? (
        <div className="ask-blake-preview-row" aria-label="Attached photos">
          {photos.map((photo, index) => (
            <div key={`${index}-${photo.slice(-24)}`} className="ask-blake-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={`Attached site photo ${index + 1}`} />
              <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => removePhoto(index)}>
                <X size={16} />
              </button>
            </div>
          ))}
          <p className="ask-blake-photo-count muted">
            {photos.length}/{ASK_BLAKE_MAX_PHOTOS}
          </p>
        </div>
      ) : null}

      <form className="ask-blake-composer" onSubmit={onSubmit}>
        <input
          ref={libraryRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(event) => {
            void onPickImages(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            void onPickImages(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <div className="ask-blake-attach">
          <button
            type="button"
            className="ask-blake-icon-btn"
            aria-label="Upload photos"
            title="Upload photos"
            onClick={() => libraryRef.current?.click()}
            disabled={busy || !canAddMore}
          >
            <ImagePlus size={18} />
          </button>
          <button
            type="button"
            className="ask-blake-icon-btn"
            aria-label="Take photo"
            title="Take photo"
            onClick={() => cameraRef.current?.click()}
            disabled={busy || !canAddMore}
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
          disabled={busy || (!draft.trim() && !photos.length)}
        >
          <SendHorizontal size={18} />
        </button>
      </form>
    </section>
  );
}
