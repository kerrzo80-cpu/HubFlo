"use client";

import type { RecordLockState } from "@/hooks/useRecordEditLock";

export function RecordEditLockBanner({ lock }: { lock: RecordLockState }) {
  if (lock.mode !== "viewer" || !lock.holderName) return null;

  return (
    <div
      className="record-edit-lock-banner"
      role="status"
      style={{
        margin: "0 0 12px",
        padding: "10px 14px",
        borderRadius: 8,
        background: "rgba(247, 144, 9, 0.12)",
        border: "1px solid rgba(247, 144, 9, 0.35)",
        color: "inherit",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span>
        <strong>{lock.holderName}</strong> is editing this record. You are in <strong>read-only</strong> mode so nothing is overwritten.
      </span>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void lock.requestAccess()}
      >
        Request access
      </button>
    </div>
  );
}
