"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";

type FileDropZoneProps = {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  label?: string;
  hint?: string;
  className?: string;
  children?: ReactNode;
  /** Compact button-style drop target (e.g. toolbar “Add document”). */
  compact?: boolean;
  /** Pass through to the hidden file input (mobile camera). */
  capture?: boolean | "user" | "environment";
};

function filesFromList(list: FileList | null | undefined) {
  return Array.from(list || []);
}

export function FileDropZone({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  label = "Drop files here or click to browse",
  hint,
  className = "",
  children,
  compact = false,
  capture,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFiles(list: FileList | null | undefined) {
    const files = filesFromList(list);
    if (!files.length || disabled || busy) return;
    setBusy(true);
    try {
      await onFiles(files);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  }

  const stateClass = [
    "file-drop-zone",
    compact ? "compact" : "",
    dragging ? "is-dragging" : "",
    disabled || busy ? "is-disabled" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={stateClass}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || busy}
      onClick={() => {
        if (disabled || busy) return;
        inputRef.current?.click();
      }}
      onKeyDown={(event) => {
        if (disabled || busy) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="file-input"
        accept={accept}
        multiple={multiple}
        capture={capture === true ? "environment" : capture || undefined}
        disabled={disabled || busy}
        onChange={(event) => void handleFiles(event.target.files)}
        onClick={(event) => event.stopPropagation()}
      />
      {children ? (
        children
      ) : (
        <div className="file-drop-zone-copy">
          <Upload size={compact ? 15 : 18} aria-hidden />
          <strong>{busy ? "Uploading…" : label}</strong>
          {hint ? <span>{hint}</span> : null}
        </div>
      )}
    </div>
  );
}
