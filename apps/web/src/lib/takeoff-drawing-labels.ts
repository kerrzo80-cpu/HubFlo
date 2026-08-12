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

/** Display label: `Heating / plan.pdf` when a set label exists. */
export function takeoffDrawingDisplayLabel(fileName: string, notes: string[] | undefined): string {
  const setLabel = takeoffSourceFolderLabel(notes);
  return setLabel ? `${setLabel} / ${fileName}` : fileName;
}

export function withSourceFolderNote(notes: string[], setLabel: string): string[] {
  const withoutFolder = notes.filter((note) => !note.startsWith(SOURCE_FOLDER_PREFIX));
  return [...withoutFolder, `${SOURCE_FOLDER_PREFIX}${setLabel}`];
}
