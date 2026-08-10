"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Upload, X } from "lucide-react";

import { FileDropZone } from "@/components/FileDropZone";
import {
  FAULT_MODULES,
  FAULT_PRIORITY_LABELS,
  FAULT_PRIORITIES,
  FAULT_TYPE_LABELS,
  FAULT_TYPES,
  guessModuleFromRoute,
  type FaultPriority,
  type FaultType,
} from "@/lib/faults-types";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
};

export function ReportFaultModal({
  open,
  onClose,
  requestHeaders,
  actorName,
  sourceRoute,
  sourcePage,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  requestHeaders: HeadersInit;
  actorName: string;
  sourceRoute?: string;
  sourcePage?: string;
  onCreated?: (reference: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [module, setModule] = useState(guessModuleFromRoute(sourceRoute, sourcePage));
  const [type, setType] = useState<FaultType>("fault");
  const [priority, setPriority] = useState<FaultPriority>("medium");
  const [files, setFiles] = useState<File[]>([]);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (!open) return;
    setModule(guessModuleFromRoute(sourceRoute, sourcePage));
    setError(null);
  }, [open, sourcePage, sourceRoute]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function toggleVoice() {
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? (window as unknown as {
            SpeechRecognition?: new () => SpeechRecognitionLike;
            webkitSpeechRecognition?: new () => SpeechRecognitionLike;
          }).SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
        : undefined;
    if (!SpeechRecognitionCtor) {
      setError("Voice reporting is not supported in this browser.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-GB";
    recognition.onresult = (event) => {
      const chunks: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) {
        chunks.push(event.results[i]?.[0]?.transcript || "");
      }
      setDescription(chunks.join(" ").trim());
    };
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function submit() {
    if (!description.trim()) {
      setError("Describe the problem or improvement.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/faults", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          description,
          module,
          type,
          priority,
          actorName,
          sourceRoute,
          sourcePage,
          classifyWithAi: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Could not create item");
      const reference = data.issue?.reference as string;
      if (files.length && reference) {
        const form = new FormData();
        form.set("scope", "fault");
        form.set("recordRef", reference);
        form.set("folderId", "evidence");
        form.set("visibility", "Private");
        for (const file of files) form.append("files", file);
        await fetch("/api/record-documents", { method: "POST", headers: requestHeaders, body: form });
      }
      onCreated?.(reference);
      setDescription("");
      setFiles([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create item");
    } finally {
      setBusy(false);
      if (listening) {
        recognitionRef.current?.stop();
        setListening(false);
      }
    }
  }

  if (!open) return null;

  return (
    <div className="report-fault-overlay" role="dialog" aria-modal="true" aria-label="Report a problem">
      <div className="report-fault-modal">
        <header>
          <div>
            <strong>Report problem / suggest improvement</strong>
            <small>
              {sourcePage || "NeXa"} · {sourceRoute || "/"}
            </small>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <label>
          What’s wrong or what should improve?
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            placeholder="Describe it in your own words — Blake can tidy it up."
          />
        </label>

        <div className="report-fault-actions-row">
          <button type="button" className={`secondary-button${listening ? " on" : ""}`} onClick={toggleVoice}>
            {listening ? <MicOff size={15} /> : <Mic size={15} />}
            {listening ? "Stop voice" : "Voice description"}
          </button>
        </div>

        <div className="report-fault-grid">
          <label>
            Module
            <select value={module} onChange={(event) => setModule(event.target.value)}>
              {FAULT_MODULES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={type} onChange={(event) => setType(event.target.value as FaultType)}>
              {FAULT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {FAULT_TYPE_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as FaultPriority)}>
              {FAULT_PRIORITIES.map((item) => (
                <option key={item} value={item}>
                  {FAULT_PRIORITY_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <FileDropZone
          label="Add screenshot, photo, video or file"
          hint="Optional evidence"
          multiple
          onFiles={(next) => setFiles((current) => [...current, ...next])}
        />
        {files.length ? (
          <p className="report-fault-files">
            <Upload size={14} /> {files.length} file{files.length === 1 ? "" : "s"} ready
          </p>
        ) : null}

        {error ? <p className="report-fault-error">{error}</p> : null}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Submit"}
          </button>
        </footer>
      </div>
    </div>
  );
}
