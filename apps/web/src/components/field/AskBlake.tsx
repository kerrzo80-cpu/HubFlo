"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Camera, SendHorizontal, X } from "lucide-react";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import type { AskBlakeJobContext, AskBlakeMessage } from "@/lib/field/ask-blake";

const STARTERS = [
  "No hot water this morning — where do I start?",
  "Leak under the bath trap — what should I check?",
  "Boiler lockout — what do I look for?",
  "Blocked toilet, other fittings OK — next steps?",
];

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
        : "Ask Blake — describe the fault, or attach a site photo. I’ll give checks, steps, tools/parts, and when to escalate.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function onPickImage(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Attach a photo (image file).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Keep photos under 8MB for this pilot.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setImageDataUrl(result || null);
      setError("");
    };
    reader.readAsDataURL(file);
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
                <BlakeCharacter mood={busy && index === messages.length - 1 ? "thinking" : "guide"} size="sm" />
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

      {!messages.some((item) => item.role === "user") ? (
        <div className="ask-blake-starters" aria-label="Suggested questions">
          {STARTERS.map((starter) => (
            <button key={starter} type="button" onClick={() => void send(starter)} disabled={busy}>
              {starter}
            </button>
          ))}
        </div>
      ) : null}

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
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            void onPickImage(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          className="ask-blake-icon-btn"
          aria-label="Attach photo"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Camera size={18} />
        </button>
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
