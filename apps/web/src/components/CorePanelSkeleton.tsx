"use client";

/** Lightweight placeholder while a Core panel chunk loads. */
export function CorePanelSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="core-panel-skeleton" role="status" aria-live="polite">
      <div className="core-panel-skeleton-pulse" />
      <p>{label}</p>
    </div>
  );
}
