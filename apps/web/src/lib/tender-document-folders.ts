import type { TenderDocumentKind } from "@/lib/tenders-types";

export const TENDER_DOCUMENT_KINDS = [
  "issued-boq",
  "priced-boq",
  "form-of-tender",
  "drawing",
  "specification",
  "supplier-quote",
  "other",
] as const satisfies readonly TenderDocumentKind[];

/** Custom folder under a tender’s Documents tab (nest under a built-in kind or another folder). */
export type TenderDocumentFolder = {
  id: string;
  name: string;
  /** Built-in kind key (e.g. `drawing`) or another custom folder id. Null/undefined = top-level custom folder. */
  parentId?: string | null;
};

/** Max nesting under a built-in kind: kind → folder → subfolder. */
export const TENDER_DOCUMENT_FOLDER_MAX_DEPTH = 2;

export function isTenderDocumentKind(value: string): value is TenderDocumentKind {
  return (TENDER_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export function tenderDocumentFolderDepth(
  folders: TenderDocumentFolder[],
  folderId: string,
): number {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let depth = 0;
  let current: TenderDocumentFolder | undefined = byId.get(folderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    depth += 1;
    const parentId = current.parentId || "";
    if (!parentId || isTenderDocumentKind(parentId)) break;
    current = byId.get(parentId);
  }
  return depth;
}

/** Resolve which built-in kind a custom folder belongs under (falls back to `other`). */
export function resolveTenderDocumentFolderKind(
  folders: TenderDocumentFolder[],
  folderId: string | null | undefined,
): TenderDocumentKind {
  if (!folderId) return "other";
  if (isTenderDocumentKind(folderId)) return folderId;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current: TenderDocumentFolder | undefined = byId.get(folderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parentId = current.parentId || "";
    if (!parentId) return "other";
    if (isTenderDocumentKind(parentId)) return parentId;
    current = byId.get(parentId);
  }
  return "other";
}

export function tenderDocumentFolderPathLabel(
  folders: TenderDocumentFolder[],
  folderId: string,
  kindLabels: Partial<Record<TenderDocumentKind, string>> = {},
): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  let current: TenderDocumentFolder | undefined = byId.get(folderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    parts.unshift(current.name);
    const parentId = current.parentId || "";
    if (!parentId) break;
    if (isTenderDocumentKind(parentId)) {
      parts.unshift(kindLabels[parentId] || parentId);
      break;
    }
    current = byId.get(parentId);
  }
  return parts.join(" / ") || folderId;
}

/**
 * Label for a drawing set in Takeoff (folder chain only — e.g. "Heating", "Hot & cold").
 * Built-in kind roots like `drawing` map to "Drawings".
 */
export function tenderDrawingSetLabel(
  folders: TenderDocumentFolder[],
  folderId: string | null | undefined,
): string {
  if (!folderId || isTenderDocumentKind(folderId)) return "Drawings";
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  let current: TenderDocumentFolder | undefined = byId.get(folderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    parts.unshift(current.name);
    const parentId = current.parentId || "";
    if (!parentId || isTenderDocumentKind(parentId)) break;
    current = byId.get(parentId);
  }
  return parts.join(" / ") || "Drawings";
}

export function normalizeTenderDocumentFolders(input: unknown): TenderDocumentFolder[] {
  if (!Array.isArray(input)) return [];
  const folders: TenderDocumentFolder[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const id = typeof (row as TenderDocumentFolder).id === "string" ? (row as TenderDocumentFolder).id.trim() : "";
    const name = typeof (row as TenderDocumentFolder).name === "string" ? (row as TenderDocumentFolder).name.trim() : "";
    if (!id || !name) continue;
    const parentRaw = (row as TenderDocumentFolder).parentId;
    const parentId = typeof parentRaw === "string" && parentRaw.trim() ? parentRaw.trim() : null;
    folders.push({ id, name: name.slice(0, 80), parentId });
  }
  const ids = new Set(folders.map((folder) => folder.id));
  return folders.filter((folder) => {
    const parentId = folder.parentId;
    if (!parentId) return true;
    if (isTenderDocumentKind(parentId)) return true;
    return ids.has(parentId);
  });
}
