/** Browser local backup of Takeoff Studio markups — survives accidental navigation / tender switches. */

import type { StudioState } from "@/lib/takeoff-studio";

export const TAKEOFF_STUDIO_DRAFT_PREFIX = "nexa-takeoff-studio-draft:";

export type TakeoffStudioLocalDraft = {
  projectId: string;
  savedAt: string;
  sourceTenderId?: string;
  geometryCount: number;
  scaleCount: number;
  studio: StudioState;
};

export function takeoffStudioDraftKey(projectId: string) {
  return `${TAKEOFF_STUDIO_DRAFT_PREFIX}${projectId}`;
}

export function writeTakeoffStudioLocalDraft(
  projectId: string,
  studio: StudioState,
  options?: { sourceTenderId?: string },
): string {
  if (typeof window === "undefined") return "";
  const savedAt = new Date().toISOString();
  const draft: TakeoffStudioLocalDraft = {
    projectId,
    savedAt,
    sourceTenderId: options?.sourceTenderId,
    geometryCount: studio.geometries?.length || 0,
    scaleCount: studio.scales?.length || 0,
    studio,
  };
  try {
    window.localStorage.setItem(takeoffStudioDraftKey(projectId), JSON.stringify(draft));
    return savedAt;
  } catch {
    return "";
  }
}

export function readTakeoffStudioLocalDraft(projectId: string): TakeoffStudioLocalDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(takeoffStudioDraftKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TakeoffStudioLocalDraft>;
    if (!parsed.studio || parsed.projectId !== projectId) return null;
    return {
      projectId,
      savedAt: parsed.savedAt || new Date().toISOString(),
      sourceTenderId: parsed.sourceTenderId,
      geometryCount: parsed.geometryCount ?? parsed.studio.geometries?.length ?? 0,
      scaleCount: parsed.scaleCount ?? parsed.studio.scales?.length ?? 0,
      studio: parsed.studio,
    };
  } catch {
    return null;
  }
}

/**
 * Prefer a local draft when the server copy looks wiped (fewer markups) and the draft is recent.
 */
export function shouldRestoreTakeoffStudioLocalDraft(
  serverStudio: StudioState | undefined,
  draft: TakeoffStudioLocalDraft | null,
  options?: { maxAgeMs?: number },
): boolean {
  if (!draft?.studio) return false;
  const maxAge = options?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const age = Date.now() - Date.parse(draft.savedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAge) return false;
  const serverCount = (serverStudio?.geometries?.length || 0) + (serverStudio?.scales?.length || 0);
  const draftCount = draft.geometryCount + draft.scaleCount;
  return draftCount > 0 && draftCount > serverCount;
}

/** Download the browser autosave JSON so markups survive even if the tab is lost. */
export function downloadTakeoffStudioLocalDraft(projectId: string, fileName?: string): boolean {
  if (typeof window === "undefined") return false;
  const draft = readTakeoffStudioLocalDraft(projectId);
  if (!draft) return false;
  try {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      fileName ||
      `takeoff-autosave-${projectId.slice(0, 12)}-${draft.savedAt.replace(/[:.]/g, "-")}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}
