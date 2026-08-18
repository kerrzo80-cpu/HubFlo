/** Client-safe helpers for Takeoff drawing list labels (from tender sync notes). */

export const SOURCE_TENDER_DOC_PREFIX = "sourceTenderDoc:";
export const SOURCE_FOLDER_PREFIX = "sourceFolder:";

/** Notes tag pointing at the source Core tender document id. */
export function takeoffSourceTenderDocId(notes: string[] | undefined): string | undefined {
  for (const note of notes || []) {
    if (note.startsWith(SOURCE_TENDER_DOC_PREFIX)) {
      return note.slice(SOURCE_TENDER_DOC_PREFIX.length) || undefined;
    }
  }
  return undefined;
}

/** Folder / drawing-set label copied from the tender (e.g. Heating, Hot & cold). */
export function takeoffSourceFolderLabel(notes: string[] | undefined): string | undefined {
  for (const note of notes || []) {
    if (note.startsWith(SOURCE_FOLDER_PREFIX)) {
      return note.slice(SOURCE_FOLDER_PREFIX.length) || undefined;
    }
  }
  return undefined;
}

/**
 * House-type tab for BoQ: top-level folder only.
 * "Belerno" stays Belerno; "Belerno / Hot & cold" becomes Belerno.
 */
export function takeoffHouseTypeLabel(notes: string[] | undefined): string {
  const raw = takeoffSourceFolderLabel(notes)?.trim();
  if (!raw || /^drawings?$/i.test(raw)) return "Unassigned";
  const top = raw.split(/\s*\/\s*/)[0]?.trim() || raw;
  return top || "Unassigned";
}

export function takeoffDocumentHouseTypeMap(
  documents: Array<{ id: string; notes?: string[] }>,
): Record<string, string> {
  return Object.fromEntries(documents.map((doc) => [doc.id, takeoffHouseTypeLabel(doc.notes)]));
}

export function listTakeoffHouseTypes(
  documents: Array<{ id: string; notes?: string[] }>,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const doc of documents) {
    const label = takeoffHouseTypeLabel(doc.notes);
    if (seen.has(label)) continue;
    seen.add(label);
    names.push(label);
  }
  return names.sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });
}

/** Display label: `Heating / plan.pdf` when a set label exists. */
export function takeoffDrawingDisplayLabel(fileName: string, notes: string[] | undefined): string {
  const setLabel = takeoffSourceFolderLabel(notes);
  return setLabel ? `${setLabel} / ${fileName}` : fileName;
}

export function withSourceFolderNote(notes: string[], setLabel: string): string[] {
  const withoutFolder = notes.filter((note) => !note.startsWith(SOURCE_FOLDER_PREFIX));
  return [...withoutFolder, `${SOURCE_FOLDER_PREFIX}${setLabel}`];
}
