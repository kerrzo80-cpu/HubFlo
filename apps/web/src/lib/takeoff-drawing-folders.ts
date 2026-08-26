/**
 * Takeoff drawing folders: house type → discipline → files.
 * Folder is metadata (notes), never a new file — markups/scales stay on the same document id.
 */

import {
  HOUSE_TYPE_PREFIX,
  takeoffHouseTypeNote,
  takeoffSourceFolderLabel,
  withHouseTypeNote,
} from "@/lib/takeoff-drawing-labels";

export const UNGROUPED_HOUSE_TYPE = "Ungrouped";

export const TAKEOFF_DISCIPLINE_ORDER = [
  "Hot & cold",
  "Heating",
  "Gas",
  "Sanitary & waste",
  "Waste",
  "General",
] as const;

export type TakeoffDrawingLike = {
  id: string;
  fileName: string;
  notes?: string[];
};

export type DrawingFolderMeta = {
  houseType: string;
  discipline: string | null;
  /** True when the user assigned a house-type folder (overrides parse). */
  assigned: boolean;
  inferred: boolean;
};

export type DrawingDisciplineGroup = {
  key: string;
  label: string;
  documents: TakeoffDrawingLike[];
};

export type DrawingHouseTypeFolder = {
  key: string;
  label: string;
  inferred: boolean;
  documents: TakeoffDrawingLike[];
  disciplines: DrawingDisciplineGroup[];
};

type DisciplineMatch = { label: string; pattern: RegExp };

const DISCIPLINE_MATCHES: DisciplineMatch[] = [
  { label: "Hot & cold", pattern: /\bhot\s*(?:&|and)\s*cold\b|\bh\s*&\s*c\b|\bh&c\b|\bdomestic\s*water\b|\bcold\s*water\b|\bhot\s*water\b/i },
  { label: "Heating", pattern: /\bheating\b|\bch\b|\bradiators?\b|\bufh\b|\bunderfloor\b/i },
  { label: "Gas", pattern: /\bgas\b/i },
  { label: "Sanitary & waste", pattern: /\bsanitary\b|\bwaste\b|\bdrainage\b|\bsoil\b|\bsewer\b/i },
  { label: "Waste", pattern: /\bwaste\b/i },
];

const FLOOR_TOKEN =
  /\b(?:lower\s*ground|ground|first|second|third|fourth|1st|2nd|3rd|4th|gnd|gf|ff|sf|level\s*\d+|flat\s*[a-z0-9]+)\b/i;

const HOUSE_TYPE_PATTERNS: RegExp[] = [
  /\bhouse\s*types?\s*[-–:]?\s*[a-z0-9]{1,8}\b/gi,
  /\bht[-\s]?[a-z]?\d{1,4}[a-z]?\b/gi,
  /\bplot\s*types?\s*[-–:]?\s*[a-z0-9]{1,8}\b/gi,
  /\bplot\s+\d{1,4}[a-z]?\b/gi,
  /\btypes?\s*[-–:]?\s*(?:[a-z]|\d{1,4}[a-z]?)\b/gi,
];

function stemFileName(fileName: string): string {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim();
}

function titleCaseToken(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
}

function normalizeFolderKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isKnownDisciplineLabel(value: string | null | undefined): boolean {
  const hay = (value || "").trim().toLowerCase();
  if (!hay || hay === "drawings" || hay === "drawing") return false;
  return DISCIPLINE_MATCHES.some((row) => row.label.toLowerCase() === hay);
}

export function parseDisciplineLabel(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  for (const row of DISCIPLINE_MATCHES) {
    if (row.label.toLowerCase() === raw.toLowerCase()) return row.label;
    if (row.pattern.test(raw)) return row.label;
  }
  return null;
}

export function extractHouseTypeToken(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw || isKnownDisciplineLabel(raw)) return null;
  for (const pattern of HOUSE_TYPE_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(raw);
    if (!match?.[0]) continue;
    const token = match[0].replace(/\s+/g, " ").trim();
    if (isKnownDisciplineLabel(token)) continue;
    return titleCaseToken(token);
  }
  return null;
}

function splitSourceFolderPath(sourceFolder: string | undefined): string[] {
  if (!sourceFolder?.trim()) return [];
  return sourceFolder
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && !/^(drawings?)$/i.test(part));
}

function prefixCandidate(fileName: string): string | null {
  const stem = String(fileName || "").replace(/\.[^.]+$/, "").trim();
  const parts = stem.split(/\s+-\s+|_/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const head = parts[0]!;
  if (head.length < 2 || head.length > 40) return null;
  if (isKnownDisciplineLabel(head) || FLOOR_TOKEN.test(head)) return null;
  return head.replace(/\s+/g, " ");
}

/** Shared filename prefix (before `_` / ` - `) used by 2+ drawings. */
export function inferSharedHouseTypePrefix(
  fileName: string,
  allFileNames: string[] | undefined,
): string | null {
  const mine = prefixCandidate(fileName);
  if (!mine || !allFileNames?.length) return null;
  const key = normalizeFolderKey(mine);
  const count = allFileNames.filter((name) => normalizeFolderKey(prefixCandidate(name) || "") === key).length;
  return count >= 2 ? mine : null;
}

export function inferDrawingFolderMeta(
  doc: TakeoffDrawingLike,
  allFileNames?: string[],
): DrawingFolderMeta {
  const assignedRaw = takeoffHouseTypeNote(doc.notes);
  const assigned = Boolean(assignedRaw);
  const sourcePath = splitSourceFolderPath(takeoffSourceFolderLabel(doc.notes));
  const haystack = [doc.fileName, stemFileName(doc.fileName), ...sourcePath].join(" · ");

  let houseType: string | null = assignedRaw || null;
  if (!houseType) {
    for (const part of sourcePath) {
      const token = extractHouseTypeToken(part);
      if (token) {
        houseType = token;
        break;
      }
    }
  }
  if (!houseType) {
    for (const part of sourcePath) {
      if (parseDisciplineLabel(part) || FLOOR_TOKEN.test(part)) continue;
      houseType = part;
      break;
    }
  }
  if (!houseType) houseType = extractHouseTypeToken(haystack);
  if (!houseType) houseType = inferSharedHouseTypePrefix(doc.fileName, allFileNames);

  let discipline: string | null = null;
  for (const part of sourcePath) {
    if (houseType && normalizeFolderKey(part) === normalizeFolderKey(houseType)) continue;
    const fromPart = parseDisciplineLabel(part);
    if (fromPart) {
      discipline = fromPart;
      break;
    }
  }
  if (!discipline) {
    const remaining = sourcePath.filter(
      (part) => !houseType || normalizeFolderKey(part) !== normalizeFolderKey(houseType),
    );
    if (remaining.length && !FLOOR_TOKEN.test(remaining[0]!) && !parseDisciplineLabel(remaining[0]!)) {
      // Nested non-house, non-discipline folder (keep the label).
      if (!extractHouseTypeToken(remaining[0]!)) discipline = remaining[0]!;
    }
  }
  if (!discipline) discipline = parseDisciplineLabel(doc.fileName) || parseDisciplineLabel(stemFileName(doc.fileName));

  const resolvedHouse = houseType?.trim() || UNGROUPED_HOUSE_TYPE;
  return {
    houseType: resolvedHouse,
    discipline,
    assigned,
    inferred: !assigned && resolvedHouse !== UNGROUPED_HOUSE_TYPE,
  };
}

function disciplineSortKey(label: string): number {
  const idx = TAKEOFF_DISCIPLINE_ORDER.findIndex((row) => row.toLowerCase() === label.toLowerCase());
  return idx >= 0 ? idx : 100;
}

export function groupTakeoffDrawings(
  documents: TakeoffDrawingLike[],
  extraHouseTypes: string[] = [],
): DrawingHouseTypeFolder[] {
  const allFileNames = documents.map((doc) => doc.fileName);
  const folders = new Map<string, DrawingHouseTypeFolder>();

  const ensureFolder = (label: string, inferred: boolean): DrawingHouseTypeFolder => {
    const key = normalizeFolderKey(label) || normalizeFolderKey(UNGROUPED_HOUSE_TYPE);
    const existing = folders.get(key);
    if (existing) {
      if (!inferred) existing.inferred = false;
      return existing;
    }
    const folder: DrawingHouseTypeFolder = {
      key,
      label: label.trim() || UNGROUPED_HOUSE_TYPE,
      inferred,
      documents: [],
      disciplines: [],
    };
    folders.set(key, folder);
    return folder;
  };

  for (const extra of extraHouseTypes) {
    const name = extra.trim();
    if (!name) continue;
    ensureFolder(name, false);
  }

  for (const doc of documents) {
    const meta = inferDrawingFolderMeta(doc, allFileNames);
    const folder = ensureFolder(meta.houseType, meta.inferred && !meta.assigned);
    folder.documents.push(doc);
    const discLabel = meta.discipline || "";
    const discKey = normalizeFolderKey(discLabel);
    let group = folder.disciplines.find((row) => row.key === discKey);
    if (!group) {
      group = { key: discKey, label: discLabel || "Drawings", documents: [] };
      folder.disciplines.push(group);
    }
    group.documents.push(doc);
  }

  for (const folder of folders.values()) {
    folder.disciplines.sort((a, b) => {
      if (!a.key && b.key) return 1;
      if (a.key && !b.key) return -1;
      const order = disciplineSortKey(a.label) - disciplineSortKey(b.label);
      if (order !== 0) return order;
      return a.label.localeCompare(b.label);
    });
    for (const group of folder.disciplines) {
      group.documents.sort((a, b) => a.fileName.localeCompare(b.fileName));
    }
  }

  return [...folders.values()].sort((a, b) => {
    if (a.label === UNGROUPED_HOUSE_TYPE && b.label !== UNGROUPED_HOUSE_TYPE) return 1;
    if (b.label === UNGROUPED_HOUSE_TYPE && a.label !== UNGROUPED_HOUSE_TYPE) return -1;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}

export function assignDrawingHouseType<T extends TakeoffDrawingLike>(
  documents: T[],
  documentId: string,
  houseType: string,
): T[] {
  const label = houseType.trim();
  return documents.map((doc) => {
    if (doc.id !== documentId) return doc;
    return { ...doc, notes: withHouseTypeNote(doc.notes || [], label) };
  });
}

export function houseTypeByDocumentId(
  documents: TakeoffDrawingLike[],
): Record<string, string> {
  const allFileNames = documents.map((doc) => doc.fileName);
  const out: Record<string, string> = {};
  for (const doc of documents) {
    out[doc.id] = inferDrawingFolderMeta(doc, allFileNames).houseType;
  }
  return out;
}

/** True when at least one drawing still needs a house-type folder (leftover). */
export function ungroupedTakeoffDrawingCount(documents: TakeoffDrawingLike[]): number {
  return groupTakeoffDrawings(documents)
    .filter((folder) => folder.label === UNGROUPED_HOUSE_TYPE)
    .reduce((sum, folder) => sum + folder.documents.length, 0);
}

export function drawingFolderOpenKeys(meta: DrawingFolderMeta): { houseType: string; discipline: string } {
  return {
    houseType: normalizeFolderKey(meta.houseType) || normalizeFolderKey(UNGROUPED_HOUSE_TYPE),
    discipline: normalizeFolderKey(meta.discipline || ""),
  };
}

export { HOUSE_TYPE_PREFIX };
