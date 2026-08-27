"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Camera, Bug, ImagePlus, Lightbulb, SendHorizontal, Video, X } from "lucide-react";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import { FileDropZone } from "@/components/FileDropZone";
import {
  ASK_BLAKE_MAX_PHOTOS,
  type AskBlakeJobContext,
  type AskBlakeMessage,
} from "@/lib/field/ask-blake";
import {
  compressAskBlakeFiles,
  compressAskBlakePhotos,
  frameFromAskBlakeVideo,
  ASK_BLAKE_RAW_PHOTO_LIMIT_BYTES,
} from "@/lib/field/ask-blake-media";

type AskBlakeChatProps = {
  job?: AskBlakeJobContext | null;
  apiPath?: string;
};

type AttachmentKind = "photo" | "video";

type PendingAttachment = {
  kind: AttachmentKind;
  previewUrl: string;
  /** JPEG data URL for Ayla (photos compressed; videos = still frame). */
  imageDataUrl: string;
  label: string;
};

export function AskBlakeChat({ job = null, apiPath = "/api/field/ask-ayla" }: AskBlakeChatProps) {
  const [messages, setMessages] = useState<AskBlakeMessage[]>([
    {
      role: "assistant",
      text: job?.jobRef
        ? `Ask me anything about ${job.jobRef}${job.costCentre ? ` · ${job.costCentre}` : ""}. Describe the fault or attach photos / a short video.`
        : "Ask Ayla — describe the fault, or attach site photos or a short video. I’ll give likely cause, checks and next steps.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [preparingMedia, setPreparingMedia] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!busy && messages.length <= 1) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  async function onPickImages(fileList: FileList | File[] | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;

    const remaining = ASK_BLAKE_MAX_PHOTOS - attachments.length;
    if (remaining <= 0) {
      setError(`You can attach up to ${ASK_BLAKE_MAX_PHOTOS} photos / video frames.`);
      return;
    }

    const selected = files.slice(0, remaining);
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
      if (file.size > ASK_BLAKE_RAW_PHOTO_LIMIT_BYTES) {
        setError("That photo is too large even to shrink (over 80MB). Try another shot.");
        return;
      }
    }

    setPreparingMedia(true);
    setError("");
    try {
      const compressed = await compressAskBlakeFiles(selected);
      const next: PendingAttachment[] = compressed.map((imageDataUrl, index) => ({
        kind: "photo" as const,
        previewUrl: imageDataUrl,
        imageDataUrl,
        label: selected[index]?.name || `Photo ${index + 1}`,
      }));
      setAttachments((current) => [...current, ...next].slice(0, ASK_BLAKE_MAX_PHOTOS));
      setError(files.length > remaining ? `Added ${remaining} — max ${ASK_BLAKE_MAX_PHOTOS}.` : "");
    } catch {
      setError("Could not prepare those photos. Try again, or take a new shot.");
    } finally {
      setPreparingMedia(false);
    }
  }

  async function onPickVideo(fileList: FileList | File[] | null) {
    const file = fileList ? Array.from(fileList)[0] : undefined;
    if (!file) return;

    const remaining = ASK_BLAKE_MAX_PHOTOS - attachments.length;
    if (remaining <= 0) {
      setError(`You can attach up to ${ASK_BLAKE_MAX_PHOTOS} photos / video frames.`);
      return;
    }

    const type = (file.type || "").toLowerCase();
    const name = file.name.toLowerCase();
    const looksLikeVideo = type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(name);
    if (!looksLikeVideo) {
      setError("Attach a short site video (mp4 / mov).");
      return;
    }
    if (file.size > ASK_BLAKE_RAW_PHOTO_LIMIT_BYTES) {
      setError("That video is too large (over 80MB). Try a shorter clip.");
      return;
    }

    setPreparingMedia(true);
    setError("");
    try {
      const frame = await frameFromAskBlakeVideo(file);
      const objectUrl = URL.createObjectURL(file);
      setAttachments((current) =>
        [
          ...current,
          {
            kind: "video" as const,
            previewUrl: objectUrl,
            imageDataUrl: frame,
            label: file.name || "Site video",
          },
        ].slice(0, ASK_BLAKE_MAX_PHOTOS),
      );
    } catch {
      setError("Could not read that video. Try a shorter mp4, or send a photo instead.");
    } finally {
      setPreparingMedia(false);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((current) => {
      const item = current[index];
      if (item?.kind === "video" && item.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function cancelBusy() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setError("Cancelled — try again with fewer / smaller photos.");
  }

  async function send(message: string) {
    const trimmed = message.trim();
    if ((!trimmed && !attachments.length) || busy) return;

    const isProductFeedback =
      /^report a problem\b/i.test(trimmed) || /^suggest an improvement\b/i.test(trimmed);

    // Product feedback goes through Core Ayla (Faults), not the trade fault helper.
    if (isProductFeedback) {
      const nextHistory = messages.filter((item) => item.role === "user" || item.role === "assistant");
      const userMessage: AskBlakeMessage = { role: "user", text: trimmed };
      setMessages((current) => [...current, userMessage]);
      setDraft("");
      setBusy(true);
      setError("");
      setWarning("");
      try {
        const response = await fetch("/api/nexa-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            message: trimmed,
            history: nextHistory.slice(-10).map((item) => ({ role: item.role, text: item.text })),
            sourceRoute: "/field/ask",
            sourcePage: "Ask Ayla Field",
            channel: "mobile_text",
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          reply?: string;
          error?: string;
          action?: { id: string; title: string; detail: string; confirmLabel: string };
        };
        if (!response.ok) throw new Error(body.error || "Could not log that feedback.");
        const reply =
          body.reply?.trim() ||
          "I’ve drafted that for Faults — confirm in Core Ask Ayla if you don’t see a confirm button here.";
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            text: body.action
              ? `${reply}\n\n${body.action.title}: ${body.action.detail}\nTap Confirm in Core Ask Ayla / Faults inbox to save it.`
              : reply,
          },
        ]);
      } catch (sendError) {
        setError(sendError instanceof Error ? sendError.message : "Could not log that feedback.");
        setMessages((current) => current.slice(0, -1));
        setDraft(trimmed);
      } finally {
        setBusy(false);
      }
      return;
    }

    const hasVideo = attachments.some((item) => item.kind === "video");
    const photoCount = attachments.filter((item) => item.kind === "photo").length;
    const userText = trimmed || (
      hasVideo && photoCount === 0
        ? "What do you see in this video still, and what should I check next?"
        : attachments.length > 1
          ? "What do you see in these photos, and what should I check next?"
          : "What do you see in this photo, and what should I check next?"
    );
    const attached = [...attachments];
    const nextHistory = messages.filter((item) => item.role === "user" || item.role === "assistant");
    const userMessage: AskBlakeMessage = {
      role: "user",
      text: userText,
      hasImage: attached.length > 0,
      imageCount: attached.length,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setAttachments([]);
    setBusy(true);
    setError("");
    setWarning("");

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutMs = 40_000;
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const compressed = await compressAskBlakePhotos(attached.map((item) => item.imageDataUrl));
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: hasVideo
            ? `${userText}\n\n(Note: a site video was attached — Ayla is reviewing a still frame from it.)`
            : userText,
          imageDataUrls: compressed,
          history: nextHistory.slice(-10),
          job,
        }),
      });
      const raw = await response.text();
      let body: {
        reply?: string;
        error?: string;
        warning?: string;
        provider?: string;
      } = {};
      try {
        body = raw ? JSON.parse(raw) as typeof body : {};
      } catch {
        if (!response.ok) {
          throw new Error(raw.trim() || "Ask Ayla could not reply.");
        }
        throw new Error("Ask Ayla returned a bad response.");
      }
      if (!response.ok) throw new Error(body.error || raw.trim() || "Ask Ayla could not reply.");
      if (!body.reply?.trim()) throw new Error("Ask Ayla returned an empty reply.");
      setMessages((current) => [...current, { role: "assistant", text: body.reply!.trim() }]);
      if (body.warning) setWarning(body.warning);
      for (const item of attached) {
        if (item.kind === "video" && item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    } catch (sendError) {
      const aborted = sendError instanceof DOMException && sendError.name === "AbortError";
      setError(
        aborted
          ? "That took too long — usually big photos. Try again with 1 photo, or describe it in text."
          : sendError instanceof Error ? sendError.message : "Ask Ayla could not reply.",
      );
      setMessages((current) => current.slice(0, -1));
      setDraft(trimmed);
      setAttachments(attached);
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const canAddMore = attachments.length < ASK_BLAKE_MAX_PHOTOS;
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <section className="ask-ayla ask-blake" aria-label="Ask Ayla">
      <div className="ask-blake-thread">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`ask-blake-bubble ${message.role === "assistant" ? "is-ayla is-blake" : "is-user"}`}
          >
            {message.role === "assistant" ? (
              <span className="ask-blake-avatar">
                <BlakeCharacter
                  mood={
                    error && index === lastAssistantIndex
                      ? "alert"
                      : index === 0
                        ? "idle"
                        : index === lastAssistantIndex
                          ? "good"
                          : "guide"
                  }
                  size="sm"
                />
              </span>
            ) : null}
            <div>
              <p>{message.text}</p>
              {message.hasImage ? (
                <span className="ask-blake-photo-tag">
                  {(message.imageCount ?? 1) > 1
                    ? `${message.imageCount} media attached`
                    : "Media attached"}
                </span>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="ask-blake-bubble is-ayla is-blake">
            <span className="ask-blake-avatar">
              <BlakeCharacter mood="thinking" size="sm" />
            </span>
            <div>
              <p className="muted">Ayla is checking that…</p>
              <button type="button" className="ask-blake-cancel" onClick={cancelBusy}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {warning ? <div className="feedback">{warning}</div> : null}
      {error ? <div className="feedback error">{error}</div> : null}
      {preparingMedia ? <div className="feedback">Preparing media for Ayla…</div> : null}

      <div className="ask-blake-feedback-chips" aria-label="Feedback actions">
        <button
          type="button"
          className="ask-blake-feedback-chip"
          disabled={busy || preparingMedia}
          onClick={() => {
            setDraft("Report a problem: ");
            setMessages((current) => [
              ...current,
              {
                role: "assistant",
                text: "Tell me what’s wrong with the app (and which screen if it helps). I’ll draft a Faults entry for you to confirm.",
              },
            ]);
          }}
        >
          <Bug size={14} />
          Report a problem
        </button>
        <button
          type="button"
          className="ask-blake-feedback-chip"
          disabled={busy || preparingMedia}
          onClick={() => {
            setDraft("Suggest an improvement: ");
            setMessages((current) => [
              ...current,
              {
                role: "assistant",
                text: "What should blake. do better? I’ll log it as an improvement for you to confirm.",
              },
            ]);
          }}
        >
          <Lightbulb size={14} />
          Suggest an improvement
        </button>
      </div>

      {attachments.length ? (
        <div className="ask-blake-preview-row" aria-label="Attached media">
          {attachments.map((item, index) => (
            <div key={`${index}-${item.label}`} className="ask-blake-preview">
              {item.kind === "video" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={item.previewUrl} muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt={`Attached site photo ${index + 1}`} />
              )}
              <button type="button" aria-label={`Remove attachment ${index + 1}`} onClick={() => removeAttachment(index)}>
                <X size={16} />
              </button>
            </div>
          ))}
          <p className="ask-blake-photo-count muted">
            {attachments.length}/{ASK_BLAKE_MAX_PHOTOS}
          </p>
        </div>
      ) : null}

      <form className="ask-blake-composer" onSubmit={onSubmit}>
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
          <FileDropZone
            accept="image/*,.heic,.heif"
            multiple
            disabled={busy || preparingMedia || !canAddMore}
            compact
            className="ask-blake-drop"
            label="Drop photos"
            onFiles={(files) => void onPickImages(files)}
          >
            <span className="ask-blake-icon-btn" aria-hidden>
              <ImagePlus size={18} />
            </span>
          </FileDropZone>
          <button
            type="button"
            className="ask-blake-icon-btn"
            aria-label="Take photo"
            title="Take photo"
            onClick={() => cameraRef.current?.click()}
            disabled={busy || preparingMedia || !canAddMore}
          >
            <Camera size={18} />
          </button>
          <FileDropZone
            accept="video/*,.mp4,.mov,.webm,.m4v"
            capture="environment"
            disabled={busy || preparingMedia || !canAddMore}
            compact
            className="ask-blake-drop"
            label="Drop video"
            onFiles={(files) => void onPickVideo(files)}
          >
            <span className="ask-blake-icon-btn" aria-hidden>
              <Video size={18} />
            </span>
          </FileDropZone>
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={job ? "Ask about this job…" : "Ask Ayla…"}
          rows={2}
          disabled={busy || preparingMedia}
        />
        <button
          type="submit"
          className="ask-blake-icon-btn is-send"
          aria-label="Send"
          disabled={busy || preparingMedia || (!draft.trim() && !attachments.length)}
        >
          <SendHorizontal size={18} />
        </button>
      </form>
    </section>
  );
}
