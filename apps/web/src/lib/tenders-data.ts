import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  deleteServerStore,
  loadServerStore,
  writeServerStore,
  getServerStoreDirectory,
} from "@/lib/server-store";
import {
  isBoqSheetEchoHeader,
  layerSectionFromSheetName,
  looksLikeSupplierQuoteSheetName,
  looksLikeTakeoffPipeMetreLine,
} from "@/lib/tender-boq-sections";
import {
  BOQ_SHEET_MARKER,
  type WorkbookSheetRows,
} from "@/lib/tenders-xlsx";
import { createJob, getJob, getJobs, updateJob } from "@/lib/workflow-data";
import {
  applyBuiltTenderStructureToJob,
  applyTenderBoqStructureToJob,
  buildJobStructureFromBoqSummary,
  buildJobStructureFromTenderTotal,
  healStoredJobCostCentres,
  summariseTenderBoqForRebuild,
  type TenderBoqRebuildSummary,
} from "@/lib/tender-job-cost-centres";
import { leanCentresForTransport, LEAN_REBUILD_NOTICE } from "@/lib/job-cost-centres-lean";
import { createTakeoffProject, getTakeoffProject, updateTakeoffProject } from "@/lib/takeoff-data";
import {
  SOURCE_TENDER_DOC_PREFIX,
  takeoffSourceTenderDocId,
  withSourceFolderNote,
} from "@/lib/takeoff-drawing-labels";
import {
  restoreTenderStudioArchive,
  stashTenderSourcedDrawings,
} from "@/lib/takeoff-tender-archive";
import {
  deleteRecordDocumentByFileUrl,
  listRecordDocuments,
  readRecordDocumentFile,
  saveUploadedRecordDocument,
} from "@/lib/record-documents";
import {
  TENDER_DOCUMENT_FOLDER_MAX_DEPTH,
  isTenderDocumentKind,
  normalizeTenderDocumentFolders,
  resolveTenderDocumentFolderKind,
  tenderDocumentFolderDepth,
  tenderDocumentFolderPathLabel,
  tenderDrawingSetLabel,
  type TenderDocumentFolder,
} from "@/lib/tender-document-folders";
import {
  TENDER_STATUSES,
  alertForDeadline,
  computeBoqTotal,
  daysLeftForDeadline,
  sortTendersByDueDate,
  type Tender,
  type TenderBoqLine,
  type TenderDayworkRates,
  type TenderDocument,
  type TenderDocumentKind,
  type TenderStatus,
} from "@/lib/tenders-types";

export * from "@/lib/tenders-types";
export {
  TENDER_DOCUMENT_FOLDER_MAX_DEPTH,
  isTenderDocumentKind,
  normalizeTenderDocumentFolders,
  resolveTenderDocumentFolderKind,
  tenderDocumentFolderDepth,
  tenderDocumentFolderPathLabel,
  tenderDrawingSetLabel,
} from "@/lib/tender-document-folders";
export type { TenderDocumentFolder } from "@/lib/tender-document-folders";
export {
  takeoffDrawingDisplayLabel,
  takeoffSourceFolderLabel,
  takeoffSourceTenderDocId,
} from "@/lib/takeoff-drawing-labels";

type TenderStore = {
  tenders: Tender[];
};

const STORE = "nexa-tenders-v1";

const DEFAULT_DAYWORK: TenderDayworkRates = {
  labourPerHour: 60,
  materialsUpliftPercent: 25,
  plantUpliftPercent: 20,
};

const DEFAULT_QUALIFICATIONS = [
  "Tender sum is based on the priced plumbing and heating items in the attached Bill of Quantities only.",
  "Prime Cost sums, provisional sums and main contractor contingencies are excluded unless expressly included in writing.",
  "Powered access, scaffolding/platforms over 3m, skips, builder attendance, builders' work and making good are excluded unless expressly included.",
  "VAT is excluded unless expressly stated otherwise.",
];

/** Stable unique ids — never Date.now()+tiny-random (collisions corrupt multi-sheet BoQs). */
function uid(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Keep BoQ line identity and sheet tabs stable across save/reload.
 * - Unique `id` per line (duplicate ids made edits/Blake overwrite other sheets)
 * - Trimmed `sheet` labels so tab keys match filter/export
 */
export function normalizeBoqLines(lines: TenderBoqLine[] | null | undefined): TenderBoqLine[] {
  if (!Array.isArray(lines) || !lines.length) return Array.isArray(lines) ? lines : [];
  const seen = new Set<string>();
  let changed = false;
  const next = lines.map((line) => {
    const prevId = typeof line.id === "string" ? line.id.trim() : "";
    let id = prevId;
    if (!id || seen.has(id)) {
      id = uid("boq");
      changed = true;
    }
    seen.add(id);

    const sheetRaw = typeof line.sheet === "string" ? line.sheet : undefined;
    const sheet = sheetRaw?.trim() ? sheetRaw.trim() : undefined;
    const sectionRaw = typeof line.section === "string" ? line.section : undefined;
    const section = sectionRaw?.trim() ? sectionRaw.trim() : undefined;

    if (id === line.id && sheet === line.sheet && section === line.section) return line;
    changed = true;
    return {
      ...line,
      id,
      sheet,
      section: section || sheet,
    };
  });
  return changed ? next : lines;
}

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function seedTenders(): Tender[] {
  const now = nowIso();
  return [
    {
      id: "tender-harlaw",
      name: "1 Harlaw Road — New Key Depot & Office Hub",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeenshire",
      submissionDeadline: "2026-07-13",
      status: "Sent",
      owner: "Brian Kerr",
      bidValue: 64385,
      tenderSum: 64385,
      winProbability: 40,
      materialsNote: "Supplier quotes received",
      qualifications: [
        ...DEFAULT_QUALIFICATIONS,
        "Items 14/1/b and 14/1/c include budget allowances of £300 each for disconnection of the existing gas pipework serving the gas radiant heaters only.",
        "Electrical disconnection, physical removal, storage, disposal, reinstallation, reconnection and commissioning of the gas radiant heaters are excluded.",
        "Forming and preparation of wet room floors is by others and excluded from our tender.",
      ],
      daywork: { ...DEFAULT_DAYWORK },
      boqTitle: "Plumbing e-Enquiry [A'Shire C - 1 Harlaw Road, Inverurie]",
      boqLines: [
        { id: "h1", kind: "header", description: "SANITARY APPLIANCES AND SANITARY FITTINGS; ARMITAGE SHANKS" },
        {
          id: "l1",
          kind: "measured",
          ref: "8/1/A",
          description: "Doc M Toilet Pack, complete with Grab Rails; complete installation as per drawings",
          quantity: 1,
          unit: "nr",
          rate: 1836,
          value: 1836,
        },
        {
          id: "l2",
          kind: "measured",
          ref: "8/1/B",
          description: "Profile 21 50cm Semi Countertop Washbasin",
          quantity: 4,
          unit: "nr",
          rate: 359,
          value: 1436,
        },
        { id: "h2", kind: "header", description: "DRAINAGE ABOVE GROUND" },
        {
          id: "l3",
          kind: "measured",
          ref: "8/2/A",
          description: "above ground foul drainage installation",
          quantity: 1,
          unit: "ite",
          rate: 3775,
          value: 3775,
        },
        {
          id: "l4",
          kind: "measured",
          ref: "14/1/b",
          description: "Allow for the electrical and gas pipework disconnection and careful removal of gas radiant heaters",
          quantity: 1,
          unit: "nr",
          rate: 300,
          value: 300,
          note: "Gas connection only",
        },
        {
          id: "l5",
          kind: "measured",
          ref: "14/1/d",
          description: "Allow for the removal of existing compressed air pipework, fittings, supports and equipment",
          quantity: 1,
          unit: "ITEM",
          rate: null,
          value: null,
        },
      ],
      documents: [
        {
          id: "doc-fot-harlaw",
          kind: "form-of-tender",
          name: "Form_of_Tender_1_Harlaw_Road_Burns_Construction_EWG.pdf",
          uploadedAt: now,
          note: "Submitted FoT",
        },
        {
          id: "doc-boq-harlaw",
          kind: "priced-boq",
          name: "Plumbing.xlsx",
          uploadedAt: now,
          note: "Priced return BoQ",
        },
      ],
      submittedAt: "2026-07-13T12:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "tender-st-andrews",
      name: "St Andrews School Fraserburgh",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeenshire",
      submissionDeadline: "2026-08-19",
      status: "In Progress",
      owner: "Laura Kenyon",
      bidValue: 0,
      tenderSum: 0,
      winProbability: 50,
      materialsNote: "",
      qualifications: [...DEFAULT_QUALIFICATIONS],
      daywork: { ...DEFAULT_DAYWORK },
      boqTitle: "",
      boqLines: [],
      documents: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "tender-ury",
      externalId: "183757",
      name: "Ury Estate Housing",
      client: "Chap",
      category: "Plumbing",
      area: "Aberdeenshire",
      status: "Sent",
      owner: "Danelle",
      bidValue: 2132745.11,
      tenderSum: 2132745.11,
      materialsNote: "",
      qualifications: [...DEFAULT_QUALIFICATIONS],
      daywork: { ...DEFAULT_DAYWORK },
      boqLines: [],
      documents: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function moneyClose(a: number | undefined, b: number) {
  return Math.abs((Number.isFinite(a) ? Number(a) : 0) - b) < 0.005;
}

function healTenderInMemory(tender: Tender): Tender {
  const boqLines = normalizeBoqLines(tender.boqLines);
  const boqTotal = computeBoqTotal(boqLines);
  const linesChanged = boqLines !== tender.boqLines;
  const sumsOutOfSync = !moneyClose(tender.bidValue, boqTotal) || !moneyClose(tender.tenderSum, boqTotal);
  if (!linesChanged && !sumsOutOfSync) return tender;
  return { ...tender, boqLines, bidValue: boqTotal, tenderSum: boqTotal };
}

/** Per-tender BoQ side store — keeps Bills out of the meta JSON that rebuild/patch rewrite. */
function tenderBoqStoreName(tenderId: string) {
  return `nexa-tender-boq-v1:${tenderId}`;
}

function readBoqLines(tenderId: string): TenderBoqLine[] {
  const stored = loadServerStore<{ lines?: TenderBoqLine[] }>(tenderBoqStoreName(tenderId), { lines: [] });
  return Array.isArray(stored.lines) ? stored.lines : [];
}

function tenderBoqSummaryStoreName(tenderId: string) {
  return `nexa-tender-boq-summary-v1:${tenderId}`;
}

function writeBoqRebuildSummary(tenderId: string, summary: TenderBoqRebuildSummary) {
  writeServerStore(tenderBoqSummaryStoreName(tenderId), summary);
}

function readBoqRebuildSummary(tenderId: string): TenderBoqRebuildSummary | null {
  const stored = loadServerStore<Partial<TenderBoqRebuildSummary>>(tenderBoqSummaryStoreName(tenderId), {});
  if (!stored || typeof stored !== "object") return null;
  if (!Array.isArray(stored.buckets)) return null;
  return {
    totalSell: typeof stored.totalSell === "number" ? stored.totalSell : 0,
    lineCount: typeof stored.lineCount === "number" ? stored.lineCount : 0,
    buckets: stored.buckets as TenderBoqRebuildSummary["buckets"],
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : nowIso(),
  };
}

function writeBoqLines(tenderId: string, lines: TenderBoqLine[]) {
  const safeLines = Array.isArray(lines) ? lines : [];
  writeServerStore(tenderBoqStoreName(tenderId), {
    lines: safeLines,
    updatedAt: nowIso(),
  });
  // Tiny floor/service recipe for crash-proof rebuild — never load lines again to rebuild jobs.
  try {
    writeBoqRebuildSummary(tenderId, summariseTenderBoqForRebuild(safeLines));
  } catch {
    // Summary is best-effort; rebuild can still use tender total.
  }
}

function deleteBoqLinesStore(tenderId: string) {
  deleteServerStore(tenderBoqStoreName(tenderId));
}

/** Attach BoQ from side store; migrate legacy inline lines once. */
function attachBoq(tender: Tender): Tender {
  let lines = readBoqLines(tender.id);
  if (!lines.length && Array.isArray(tender.boqLines) && tender.boqLines.length) {
    lines = tender.boqLines;
    writeBoqLines(tender.id, lines);
  } else if (lines.length && !readBoqRebuildSummary(tender.id)) {
    // Backfill tiny rebuild recipe when an existing side-store Bill is opened.
    try {
      writeBoqRebuildSummary(tender.id, summariseTenderBoqForRebuild(lines));
    } catch {
      // ignore
    }
  }
  return healTenderInMemory({ ...tender, boqLines: lines });
}

/** Raw meta store — BoQ arrays must be empty here after writeStore. */
function readStoreRaw(): TenderStore {
  const stored = loadServerStore<Partial<TenderStore>>(STORE, { tenders: [] });
  const tenders = Array.isArray(stored.tenders) ? (stored.tenders as Tender[]) : [];
  if (!tenders.length) {
    const seeded = { tenders: seedTenders().map((tender) => {
      if (tender.boqLines?.length) writeBoqLines(tender.id, tender.boqLines);
      return { ...tender, boqLines: [] };
    }) };
    writeServerStore(STORE, seeded);
    return seeded;
  }
  return { tenders };
}

function readStore(): TenderStore {
  // Attach BoQ only when callers need full tenders (rare). Prefer getTender / listTendersLean.
  return { tenders: readStoreRaw().tenders.map(attachBoq) };
}

/**
 * Patch tender job-link / status / sums without touching BoQ side stores.
 * Meta JSON stays lean — this is what rebuild/heal must use.
 */
export function patchTenderJobLink(
  tenderId: string,
  patch: {
    status?: TenderStatus;
    convertedJobId?: string;
    convertedJobRef?: string;
    tenderSum?: number;
    bidValue?: number;
  },
): Tender {
  const store = readStoreRaw();
  const index = store.tenders.findIndex((tender) => tender.id === tenderId);
  if (index < 0) throw new Error("Tender not found.");
  const existing = store.tenders[index]!;
  const next: Tender = {
    ...existing,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.convertedJobId !== undefined ? { convertedJobId: patch.convertedJobId } : {}),
    ...(patch.convertedJobRef !== undefined ? { convertedJobRef: patch.convertedJobRef } : {}),
    ...(typeof patch.tenderSum === "number" && Number.isFinite(patch.tenderSum)
      ? { tenderSum: patch.tenderSum }
      : {}),
    ...(typeof patch.bidValue === "number" && Number.isFinite(patch.bidValue)
      ? { bidValue: patch.bidValue }
      : {}),
    boqLines: [],
    updatedAt: nowIso(),
  };
  store.tenders[index] = next;
  writeStore(store);
  return attachBoq(next);
}

function writeStore(store: TenderStore) {
  // Always externalise inline Bills, then persist lean meta only.
  const leanTenders = store.tenders.map((tender) => {
    if (Array.isArray(tender.boqLines) && tender.boqLines.length > 0) {
      writeBoqLines(tender.id, tender.boqLines);
      tender.boqLines = [];
    }
    return { ...tender, boqLines: [] as TenderBoqLine[] };
  });
  const lean = { tenders: leanTenders };
  writeServerStore(STORE, lean);
  return lean;
}

export function listTenders() {
  return sortTendersByDueDate(readStore().tenders);
}

/** Strip heavy BoQ payloads before returning tender metadata to the client. */
export function leanTenderForClient(tender: Tender): Tender {
  return {
    ...tender,
    boqLines: [],
    boqTitle: tender.boqTitle,
  };
}

/** Tracker-safe list — BoQ lines stripped; does not heal/walk every Bill. */
export function listTendersLean() {
  return sortTendersByDueDate(readStoreRaw().tenders.map(leanTenderForClient));
}

export function getTender(id: string) {
  const raw = readStoreRaw().tenders.find((tender) => tender.id === id);
  return raw ? attachBoq(raw) : null;
}

function normalizeTenderDocument(input: Partial<TenderDocument> | null | undefined): TenderDocument {
  const kindRaw = typeof input?.kind === "string" ? input.kind : "other";
  const kind: TenderDocumentKind = isTenderDocumentKind(kindRaw) ? kindRaw : "other";
  const folderId = typeof input?.folderId === "string" && input.folderId.trim() ? input.folderId.trim() : undefined;
  return {
    id: typeof input?.id === "string" && input.id.trim() ? input.id.trim() : uid("tdoc"),
    kind,
    name: typeof input?.name === "string" && input.name.trim() ? input.name.trim() : "Document",
    mimeType: typeof input?.mimeType === "string" ? input.mimeType : undefined,
    url: typeof input?.url === "string" ? input.url : undefined,
    uploadedAt: typeof input?.uploadedAt === "string" && input.uploadedAt ? input.uploadedAt : nowIso(),
    note: typeof input?.note === "string" && input.note.trim() ? input.note.trim() : undefined,
    folderId,
  };
}

function normalizeTender(input: Partial<Tender> & { name: string; client: string }): Tender {
  const now = nowIso();
  const lines = normalizeBoqLines(Array.isArray(input.boqLines) ? input.boqLines : []);
  const boqTotal = computeBoqTotal(lines);
  return {
    id: input.id || uid("tender"),
    externalId: input.externalId?.trim() || undefined,
    name: input.name.trim(),
    client: input.client.trim(),
    clientId: input.clientId?.trim() || undefined,
    linkedTakeoffId: input.linkedTakeoffId?.trim() || undefined,
    linkedTakeoffRef: input.linkedTakeoffRef?.trim() || undefined,
    category: input.category?.trim() || "Plumbing",
    area: input.area?.trim() || "Aberdeen",
    submissionDeadline: input.submissionDeadline || undefined,
    status: (TENDER_STATUSES.includes(input.status as TenderStatus) ? input.status : "Not Started") as TenderStatus,
    owner: input.owner?.trim() || "",
    // Bid value and Tender sum (FoT) always follow the priced BoQ — no manual FoT override.
    bidValue: boqTotal,
    tenderSum: boqTotal,
    winProbability: Number.isFinite(input.winProbability) ? Number(input.winProbability) : undefined,
    materialsNote: input.materialsNote || "",
    qualifications: Array.isArray(input.qualifications) && input.qualifications.length
      ? input.qualifications
      : [...DEFAULT_QUALIFICATIONS],
    daywork: {
      labourPerHour: input.daywork?.labourPerHour ?? DEFAULT_DAYWORK.labourPerHour,
      materialsUpliftPercent: input.daywork?.materialsUpliftPercent ?? DEFAULT_DAYWORK.materialsUpliftPercent,
      plantUpliftPercent: input.daywork?.plantUpliftPercent ?? DEFAULT_DAYWORK.plantUpliftPercent,
    },
    boqTitle: input.boqTitle || "",
    boqLines: lines,
    documents: Array.isArray(input.documents)
      ? input.documents.map((doc) => normalizeTenderDocument(doc))
      : [],
    documentFolders: normalizeTenderDocumentFolders(input.documentFolders),
    submittedAt: input.submittedAt,
    convertedJobId: input.convertedJobId,
    convertedJobRef: input.convertedJobRef,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function upsertTender(input: Partial<Tender> & { name: string; client: string }) {
  const next = normalizeTender(input);
  if (!next.name) throw new Error("Opportunity name is required.");
  if (!next.client) throw new Error("Client is required.");

  // BoQ lives in a side store — never bake line arrays into the meta JSON again.
  writeBoqLines(next.id, next.boqLines);
  const store = readStoreRaw();
  const meta: Tender = { ...next, boqLines: [] };
  const existingIndex = store.tenders.findIndex((tender) => tender.id === next.id);
  if (existingIndex >= 0) {
    const previous = store.tenders[existingIndex]!;
    meta.createdAt = previous.createdAt;
    store.tenders[existingIndex] = meta;
  } else {
    store.tenders.unshift(meta);
  }
  writeStore(store);
  return { ...meta, boqLines: next.boqLines };
}

export function updateTender(id: string, patch: Partial<Tender>) {
  const existing = getTender(id);
  if (!existing) throw new Error("Tender not found.");

  const nextStatus = patch.status ?? existing.status;
  const linkedJobId = patch.convertedJobId ?? existing.convertedJobId;
  // Status dropdown (or any patch) to Won must create a Core job — not status-only.
  // Skip when a job link is already present (convert path / recreate handles stale links).
  if (nextStatus === "Won" && !linkedJobId) {
    return convertTenderToPendingJob(id).tender;
  }

  // Reopening Won → Open/In Progress/etc. keeps any linked job; never silent-delete.
  return upsertTender({ ...existing, ...patch, id });
}

export function deleteTender(id: string) {
  const store = readStoreRaw();
  const before = store.tenders.length;
  store.tenders = store.tenders.filter((tender) => tender.id !== id);
  if (store.tenders.length === before) throw new Error("Tender not found.");
  writeStore(store);
  deleteBoqLinesStore(id);
  return true;
}

export function markTenderSubmitted(id: string, options?: { tenderSum?: number; submittedAt?: string }) {
  const existing = getTender(id);
  if (!existing) throw new Error("Tender not found.");
  const boqTotal = computeBoqTotal(existing.boqLines);
  return updateTender(id, {
    status: "Sent",
    submittedAt: options?.submittedAt || nowIso(),
    // FoT / bid always track BoQ; ignore any stale client-supplied tenderSum.
    tenderSum: boqTotal,
    bidValue: boqTotal,
  });
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/£/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

type BoqColumnMap = {
  ref: number;
  description: number[];
  quantity: number;
  unit: number;
  rate: number;
  value: number;
  note: number;
};

function normalizeHeaderLabel(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerMatches(label: string, candidates: string[], mode: "exact" | "includes" = "includes") {
  return candidates.some((candidate) => {
    if (label === candidate) return true;
    if (mode === "exact") return false;
    // Prefer multi-word / longer aliases so "item" does not steal "item description".
    if (candidate.length >= 4 && label.includes(candidate)) return true;
    return false;
  });
}

function looksLikeUnit(value: string) {
  return /^(nr|no|nos|item|items|m2|m²|m3|m³|m|mm|lm|lin|lin m|lin\.?m|sum|lot|wk|hr|hrs|kg|t|tonne|set|pair|each|ea)$/i.test(
    String(value || "").trim(),
  );
}

function defaultBoqColumnMap(width: number): BoqColumnMap {
  return {
    ref: 0,
    description: width > 1 ? [1] : [0],
    quantity: Math.min(2, Math.max(0, width - 1)),
    unit: Math.min(3, Math.max(0, width - 1)),
    rate: Math.min(4, Math.max(0, width - 1)),
    value: Math.min(5, Math.max(0, width - 1)),
    note: width > 6 ? 6 : -1,
  };
}

/** Prefer material/unit rate columns; avoid Labour Rate when both exist. */
function pickBoqRateColumn(labels: string[]): number {
  const candidates: number[] = [];
  labels.forEach((label, index) => {
    if (headerMatches(label, ["unit rate", "rate", "price"])) candidates.push(index);
  });
  const nonLabour = candidates.find((index) => !/\blabou?r\b/.test(labels[index] || ""));
  return nonLabour ?? candidates[0] ?? -1;
}

/**
 * Prefer the extended line amount (Line Total / Amount / Value) over Item Total /
 * Labour Total — otherwise Bid value under-counts labour or double-counts summaries.
 */
function pickBoqValueColumn(labels: string[]): number {
  const candidates: number[] = [];
  labels.forEach((label, index) => {
    if (headerMatches(label, ["amount", "value", "extended", "total", "sum"])) candidates.push(index);
  });
  if (!candidates.length) return -1;

  const rank = (label: string) => {
    if (/^line total$/.test(label) || /^amount$/.test(label) || /^value$/.test(label)) return 0;
    if (/^net (value|amount)$/.test(label) || /^extended/.test(label)) return 1;
    if (/\bline total\b/.test(label) || /\bnet value\b/.test(label)) return 2;
    if (/^item total$/.test(label) || /\bitem total\b/.test(label)) return 80;
    if (/\blabou?r\b/.test(label)) return 90;
    if (/^total$/.test(label) || /^sum$/.test(label) || /^£/.test(label)) return 10;
    if (/\btotal\b/.test(label) || /\bsum\b/.test(label)) return 40;
    return 50;
  };

  return [...candidates].sort((a, b) => {
    const diff = rank(labels[a] || "") - rank(labels[b] || "");
    return diff !== 0 ? diff : a - b;
  })[0]!;
}

/**
 * Skip collection / summary / carried-forward rows so Bid value does not re-add
 * section totals on top of measured lines.
 */
function isBoqSummaryOrTotalRow(ref: string, description: string, leadingCell = "") {
  const firstLine = (description.split("\n")[0] || "").trim();
  // Ref / Section often hold "TOTAL" while description is "Materials and clip costs".
  const markers = [ref, leadingCell]
    .map((text) => String(text || "").trim())
    .filter(Boolean);
  for (const text of markers) {
    if (
      /^(sub[- ]?totals?|grand[- ]?totals?|page[- ]?totals?|project[- ]?totals?|flat[- ]?totals?|totals?)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /^(to collection|amount to collection|carried (forward|to)|collection from)\b/i.test(text)
    ) {
      return true;
    }
    if (/\btotal price for this flat\b/i.test(text)) return true;
  }

  if (!firstLine) return false;
  if (
    /^(sub[- ]?totals?|grand[- ]?totals?|page[- ]?totals?|project[- ]?totals?|flat[- ]?totals?|totals?)$/i.test(
      firstLine,
    )
  ) {
    return true;
  }
  if (
    /^(to collection|amount to collection|carried (forward|to)|collection from|page totals?|cost summary)\b/i.test(
      firstLine,
    )
  ) {
    return true;
  }
  // Keep product names like "Total isolation valve"; skip clear summary phrases.
  if (
    /\b(total (labour|materials?|price|goods|net|vat|cost|shared|pc)|material subtotals?|consolidated material total|total price for this flat)\b/i.test(
      firstLine,
    )
  ) {
    return true;
  }
  return false;
}

function mapBoqColumnsFromHeader(header: string[]): BoqColumnMap | null {
  const labels = header.map(normalizeHeaderLabel);
  const ref = labels.findIndex((label) =>
    headerMatches(
      label,
      ["item ref", "item no", "item number", "bill ref", "item code", "ref", "code", "item"],
      "exact",
    ),
  );
  const descCandidates: number[] = [];
  labels.forEach((label, index) => {
    if (
      headerMatches(label, [
        "additional description",
        "full description",
        "item description",
        "work description",
        "long description",
        "description",
        "particulars",
        "specification",
        "details",
        "detail",
        "spec",
        "desc",
        "works",
      ])
    ) {
      descCandidates.push(index);
    }
  });
  if (ref < 0 && !descCandidates.length) return null;

  const quantity = labels.findIndex((label) => headerMatches(label, ["quantity", "qty"]));
  const unit = labels.findIndex((label) => headerMatches(label, ["units", "unit", "uom"]));
  const rate = pickBoqRateColumn(labels);
  const value = pickBoqValueColumn(labels);
  const note = labels.findIndex((label) =>
    headerMatches(label, ["remarks", "remark", "notes", "note", "comments", "comment"]),
  );

  const qtyIdx = quantity >= 0 ? quantity : labels.length;
  const refIdx = ref >= 0 ? ref : 0;
  for (let i = refIdx + 1; i < qtyIdx; i += 1) {
    if (descCandidates.includes(i)) continue;
    if (i === unit || i === rate || i === value || i === note) continue;
    const label = labels[i] || "";
    if (!label) {
      descCandidates.push(i);
      continue;
    }
    if (headerMatches(label, ["quantity", "qty", "units", "unit", "rate", "value", "amount", "total"])) continue;
    if (!headerMatches(label, ["page", "line", "row", "status"])) descCandidates.push(i);
  }

  const uniqueDesc = [...new Set(descCandidates.length ? descCandidates : [refIdx === 0 ? 1 : refIdx])].sort(
    (a, b) => a - b,
  );

  return {
    ref: ref >= 0 ? ref : 0,
    description: uniqueDesc.filter((index) => index >= 0 && index < header.length),
    quantity: quantity >= 0 ? quantity : Math.min(2, header.length - 1),
    unit: unit >= 0 ? unit : Math.min(3, header.length - 1),
    rate: rate >= 0 ? rate : Math.min(4, header.length - 1),
    value: value >= 0 ? value : Math.min(5, header.length - 1),
    note: note >= 0 ? note : header.length > 6 ? 6 : -1,
  };
}

function findBoqHeaderRowIndex(rows: string[][]) {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i += 1) {
    if (mapBoqColumnsFromHeader(rows[i] || [])) return i;
  }
  return -1;
}

function inferDescriptionColumns(rows: string[][], dataStart: number, width: number, refIndex: number) {
  const sample = rows.slice(dataStart, Math.min(rows.length, dataStart + 40));
  let qtyIndex = -1;
  for (let col = refIndex + 1; col < width; col += 1) {
    let numeric = 0;
    let unitish = 0;
    let textish = 0;
    for (const row of sample) {
      const cell = String(row[col] || "").trim();
      if (!cell) continue;
      if (parseNumber(cell) !== null) numeric += 1;
      else if (looksLikeUnit(cell)) unitish += 1;
      else if (/[a-zA-Z]/.test(cell)) textish += 1;
    }
    if (numeric >= Math.max(2, Math.floor(sample.length * 0.25)) && textish <= numeric) {
      qtyIndex = col;
      break;
    }
    if (unitish >= 2 && col > refIndex + 1) {
      qtyIndex = col - 1;
      break;
    }
  }
  if (qtyIndex < 0) qtyIndex = Math.min(refIndex + 2, width);
  const description: number[] = [];
  for (let col = refIndex + 1; col < qtyIndex; col += 1) description.push(col);
  if (!description.length && width > refIndex + 1) description.push(refIndex + 1);
  return {
    description,
    quantity: qtyIndex,
    unit: Math.min(qtyIndex + 1, width - 1),
    rate: Math.min(qtyIndex + 2, width - 1),
    value: Math.min(qtyIndex + 3, width - 1),
    note: Math.min(qtyIndex + 4, width - 1),
  };
}

function mergeDescriptionCells(cols: string[], indices: number[]) {
  const parts: string[] = [];
  for (const index of indices) {
    const text = String(cols[index] ?? "").replace(/^\s+|\s+$/g, "");
    if (!text) continue;
    if (parts.some((part) => part === text)) continue;
    parts.push(text);
  }
  return parts.join("\n");
}

function cellAt(cols: string[], index: number) {
  if (index < 0) return "";
  return String(cols[index] ?? "").replace(/^\s+|\s+$/g, "");
}

function isColumnHeaderRow(cols: string[], map: BoqColumnMap) {
  const ref = cellAt(cols, map.ref);
  const description = mergeDescriptionCells(cols, map.description);
  return (
    (/^ref$/i.test(ref) || /^item$/i.test(ref) || /^item ref$/i.test(ref)) &&
    /description|particulars|specification|spec/i.test(description || cellAt(cols, map.description[0] ?? -1))
  );
}

/**
 * Parse a BoQ cell matrix (preferred path for Excel — keeps multi-line cells and extra wording columns).
 */
export function parseBoqFromRows(
  rows: string[][],
  title?: string,
  options?: { sheet?: string },
): { title: string; lines: TenderBoqLine[] } {
  const matrix = (rows || [])
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
    .filter((row) => row.some((cell) => String(cell || "").trim()));
  if (!matrix.length) return { title: title || "", lines: [] };

  let resolvedTitle = title || "";
  let dataStart = 0;
  const headerIndex = findBoqHeaderRowIndex(matrix);

  if (headerIndex > 0) {
    const maybeTitle = matrix[0] || [];
    if (
      maybeTitle.length <= 2 &&
      !mapBoqColumnsFromHeader(maybeTitle) &&
      String(maybeTitle[0] || "").trim() &&
      String(maybeTitle[0] || "").trim() !== BOQ_SHEET_MARKER
    ) {
      resolvedTitle = String(maybeTitle[0] || "").trim() || resolvedTitle;
    }
  } else if (headerIndex < 0) {
    const first = matrix[0] || [];
    if (
      first.length === 1 ||
      (first[0] && !/^ref$/i.test(String(first[0])) && !String(first[1] || "").trim())
    ) {
      if (String(first[0] || "").trim() !== BOQ_SHEET_MARKER) {
        resolvedTitle = String(first[0] || "").trim() || resolvedTitle;
        dataStart = 1;
      }
    }
  }

  let map: BoqColumnMap = defaultBoqColumnMap(Math.max(...matrix.map((row) => row.length), 1));
  if (headerIndex >= 0) {
    map = mapBoqColumnsFromHeader(matrix[headerIndex] || []) || map;
    dataStart = headerIndex + 1;
  } else {
    const width = Math.max(...matrix.slice(dataStart).map((row) => row.length), 1);
    const inferred = inferDescriptionColumns(matrix, dataStart, width, 0);
    map = {
      ref: 0,
      description: inferred.description,
      quantity: inferred.quantity,
      unit: inferred.unit,
      rate: inferred.rate,
      value: inferred.value,
      note: inferred.note,
    };
  }

  const lines: TenderBoqLine[] = [];
  let currentSheet = options?.sheet?.trim() || "";
  let currentSection = "";

  for (let i = dataStart; i < matrix.length; i += 1) {
    const cols = matrix[i] || [];
    const marker = cellAt(cols, 0);
    if (marker === BOQ_SHEET_MARKER) {
      const sheetName = cellAt(cols, 1) || cellAt(cols, map.description[0] ?? 1);
      if (!sheetName) continue;
      currentSheet = sheetName;
      currentSection = "";
      lines.push({
        id: uid("boq"),
        kind: "header",
        description: sheetName,
        sheet: sheetName,
        section: sheetName,
      });
      continue;
    }

    if (isColumnHeaderRow(cols, map)) continue;

    const ref = cellAt(cols, map.ref);
    const description = mergeDescriptionCells(cols, map.description) || ref;
    const quantity = parseNumber(cellAt(cols, map.quantity));
    const unit = cellAt(cols, map.unit);
    const rate = parseNumber(cellAt(cols, map.rate));
    const value = parseNumber(cellAt(cols, map.value));
    const note = cellAt(cols, map.note);
    // Section / leading cell often holds "TOTAL" while Ref is blank (priced flat BoQs).
    const leadingCell = cellAt(cols, 0);

    if (!description && !ref) continue;
    if (isBoqSummaryOrTotalRow(ref, description, leadingCell)) continue;

    if (!ref && quantity === null && rate === null && value === null) {
      const headerText = (description || ref).trim();
      if (!headerText) continue;
      currentSection = headerText;
      lines.push({
        id: uid("boq"),
        kind: "header",
        description: headerText,
        sheet: currentSheet || undefined,
        section: headerText,
      });
      continue;
    }

    lines.push({
      id: uid("boq"),
      kind: "measured",
      ref: ref || undefined,
      description: description || ref,
      quantity,
      unit: unit || undefined,
      rate,
      value: value ?? (rate !== null && quantity !== null ? roundMoney(rate * quantity) : null),
      note: note || undefined,
      sheet: currentSheet || undefined,
      section: currentSection || currentSheet || undefined,
    });
  }

  return { title: resolvedTitle, lines };
}

/** Split CSV/TSV respecting quoted newlines so multi-line wording stays one cell. */
export function splitDelimitedBoqText(raw: string): string[][] {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.trim()) return [];
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      row.push(current.replace(/^\s+|\s+$/g, ""));
      current = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(current.replace(/^\s+|\s+$/g, ""));
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = "";
      continue;
    }
    current += ch;
  }
  row.push(current.replace(/^\s+|\s+$/g, ""));
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

/** Parse CSV/TSV BoQ text — quote-aware so multi-line cells are not truncated. */
export function parseBoqDelimitedText(raw: string, title?: string): { title: string; lines: TenderBoqLine[] } {
  return parseBoqFromRows(splitDelimitedBoqText(raw), title);
}

/** True when a sheet looks like a fully priced bill (Line Total / similar), not a takeoff build-up. */
function sheetHasLineTotalHeader(rows: string[][]) {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const labels = (rows[i] || []).map((cell) => normalizeHeaderLabel(String(cell ?? "")));
    if (labels.some((label) => label === "line total" || /\bline total\b/.test(label))) return true;
  }
  return false;
}

/**
 * When a workbook mixes complete flat bills (Line Total) with Client / Heating / Takeoff
 * restatements of the same money, keep the Line Total bill sheets only.
 */
function preferPrimaryBoqSheets(sheets: WorkbookSheetRows[]): WorkbookSheetRows[] {
  const usable = (sheets || []).filter((sheet) =>
    sheet.rows?.some((row) => row.some((cell) => String(cell || "").trim())),
  );
  if (usable.length <= 1) return usable;

  const lineTotalSheets = usable.filter((sheet) => sheetHasLineTotalHeader(sheet.rows));
  if (!lineTotalSheets.length) return usable;

  const primary = lineTotalSheets.filter(
    (sheet) => !/^(project summary|client\b)/i.test(String(sheet.name || "").trim()),
  );
  return primary.length ? primary : lineTotalSheets;
}

/** Parse each Excel worksheet as its own sheet tab (stamps `sheet` on every line). */
export function parseBoqFromWorkbookSheets(
  sheets: WorkbookSheetRows[],
  title?: string,
): { title: string; lines: TenderBoqLine[] } {
  const usable = preferPrimaryBoqSheets(sheets);
  if (!usable.length) return { title: title || "", lines: [] };

  let resolvedTitle = title || "";
  const lines: TenderBoqLine[] = [];
  for (const sheet of usable) {
    // Trim once so tab key, filter, and rename all use the same stable sheet id string.
    const sheetName = (sheet.name || "").trim() || "Sheet";
    const parsed = parseBoqFromRows(sheet.rows, resolvedTitle || undefined, { sheet: sheetName });
    if (!resolvedTitle && parsed.title) resolvedTitle = parsed.title;
    for (const line of parsed.lines) {
      lines.push({
        ...line,
        sheet: sheetName,
        section: line.kind === "header" ? line.section || line.description : line.section || sheetName,
      });
    }
  }
  return { title: resolvedTitle, lines: normalizeBoqLines(lines) };
}

/** How a BoQ file/paste lands on an existing tender bill. */
export type BoqImportMode = "replace" | "append";

export type BoqImportOptions = {
  mode?: BoqImportMode;
  /** Optional label when appending lines that have no workbook sheet tab yet. */
  appendSheetLabel?: string;
};

function nextUniqueBoqSheetName(base: string, used: Set<string>): string {
  const trimmed = base.trim() || "Additional items";
  if (!used.has(trimmed)) {
    used.add(trimmed);
    return trimmed;
  }
  let n = 2;
  while (used.has(`${trimmed} (${n})`)) n += 1;
  const next = `${trimmed} (${n})`;
  used.add(next);
  return next;
}

/**
 * Append imported lines onto an existing BoQ without wiping priced work.
 * New sheets keep distinct tab names; unsheeted imports become “Additional items”.
 * Existing takeoff / sheeted lines keep their tabs — never reassigned onto a supplier PDF tab.
 */
export function mergeBoqImportLines(
  existing: TenderBoqLine[],
  incoming: TenderBoqLine[],
  options?: { appendSheetLabel?: string },
): TenderBoqLine[] {
  if (!incoming.length) return existing.slice();
  if (!existing.length) return incoming.slice();

  const used = new Set<string>();
  const existingHasSheets = existing.some((line) => Boolean(line.sheet?.trim()));
  const incomingHasSheets = incoming.some((line) => Boolean(line.sheet?.trim()));
  let base = existing;

  // Sheet tabs hide unsheeted rows — stamp a home tab before introducing new sheets.
  if (incomingHasSheets && !existingHasSheets) {
    const home = nextUniqueBoqSheetName("Issued BoQ", used);
    base = existing.map((line) => ({
      ...line,
      sheet: home,
      section: line.section || home,
    }));
  } else {
    for (const line of existing) {
      const sheet = line.sheet?.trim();
      if (sheet) used.add(sheet);
    }
    // Orphans must not float onto a newly imported Sales Order tab in the UI.
    if (incomingHasSheets && existing.some((line) => !line.sheet?.trim())) {
      const home = nextUniqueBoqSheetName("Issued BoQ", used);
      base = existing.map((line) =>
        line.sheet?.trim()
          ? line
          : { ...line, sheet: home, section: line.section || home },
      );
    }
  }

  const rename = new Map<string, string>();
  for (const line of incoming) {
    const key = line.sheet?.trim();
    if (!key || rename.has(key)) continue;
    rename.set(key, nextUniqueBoqSheetName(key, used));
  }

  const fallbackLabel = options?.appendSheetLabel?.trim() || "Additional items";
  // Prefer a dedicated tab for unsheeted imports when the bill already uses sheet tabs
  // (or will after we stamped “Issued BoQ” above).
  const baseHasSheets = base.some((line) => Boolean(line.sheet?.trim()));
  const fallbackSheet =
    !incomingHasSheets && baseHasSheets ? nextUniqueBoqSheetName(fallbackLabel, used) : null;

  const appended = incoming.map((line) => {
    const key = line.sheet?.trim();
    if (key) {
      const sheet = rename.get(key) || key;
      const echoesSheet =
        line.kind === "header" &&
        ((line.section || "").trim() === key || (line.description || "").trim() === key);
      return {
        ...line,
        sheet,
        section: echoesSheet ? sheet : line.section || sheet,
        description: echoesSheet ? sheet : line.description,
      };
    }
    if (fallbackSheet) {
      return {
        ...line,
        sheet: fallbackSheet,
        section: line.section || fallbackSheet,
      };
    }
    return line;
  });

  return [...base, ...appended];
}

function applyBoqImport(
  id: string,
  parsed: { title: string; lines: TenderBoqLine[] },
  options?: BoqImportOptions,
) {
  const existing = getTender(id);
  if (!existing) throw new Error("Tender not found.");
  const measuredCount = (parsed.lines || []).filter((line) => line.kind === "measured").length;
  if (!measuredCount) {
    throw new Error(
      "No BoQ lines found in this import (0 measured items). Check the file is a text BoQ / supplier quote with Qty, Description and Rate columns — scanned PDFs need Excel/CSV instead.",
    );
  }
  const mode: BoqImportMode = options?.mode === "append" ? "append" : "replace";
  const beforeSheets = new Set(
    existing.boqLines.map((line) => (line.sheet || "").trim()).filter(Boolean),
  );
  const boqLines =
    mode === "append"
      ? mergeBoqImportLines(existing.boqLines, parsed.lines, {
          appendSheetLabel: options?.appendSheetLabel,
        })
      : parsed.lines;
  const boqTotal = computeBoqTotal(boqLines);
  const tender = updateTender(id, {
    boqTitle:
      mode === "append"
        ? existing.boqTitle || parsed.title || existing.boqTitle
        : parsed.title || existing.boqTitle,
    boqLines,
    bidValue: boqTotal,
    tenderSum: boqTotal,
    status: existing.status === "Not Started" ? "In Progress" : existing.status,
  });
  const addedSheets = [
    ...new Set(
      tender.boqLines
        .map((line) => (line.sheet || "").trim())
        .filter((sheet) => sheet && (mode === "replace" || !beforeSheets.has(sheet))),
    ),
  ];
  return { ...tender, addedSheets };
}

/**
 * Paste / CSV imports in append mode always get their own sheet tab.
 * Never leave lines unsheeted (easy to mis-attribute) and never reuse a supplier
 * PDF tab name from a previous drop — paste stays on “Additional items” / label.
 */
function stampAppendSheetOnParsedLines(
  parsed: { title: string; lines: TenderBoqLine[] },
  options?: BoqImportOptions,
): { title: string; lines: TenderBoqLine[] } {
  if (options?.mode !== "append") return parsed;
  const label = options.appendSheetLabel?.trim() || "Additional items";
  return {
    title: parsed.title,
    lines: parsed.lines.map((line) => {
      if (line.sheet?.trim()) return line;
      return {
        ...line,
        sheet: label,
        section: line.section || label,
      };
    }),
  };
}

/** Drop takeoff pipe-metre noise from supplier workbook sheets (sales-order PDFs). */
function stripTakeoffPipeMetresFromSupplierSheets(
  parsed: { title: string; lines: TenderBoqLine[] },
): { title: string; lines: TenderBoqLine[] } {
  const lines = parsed.lines.filter((line) => {
    if (line.kind !== "measured") return true;
    if (!looksLikeSupplierQuoteSheetName(line.sheet || "")) return true;
    return !looksLikeTakeoffPipeMetreLine(line.ref || "", line.description || "");
  });
  return { title: parsed.title, lines };
}

export function importBoqIntoTender(id: string, raw: string, title?: string, options?: BoqImportOptions) {
  return applyBoqImport(id, stampAppendSheetOnParsedLines(parseBoqDelimitedText(raw, title), options), options);
}

export function importBoqRowsIntoTender(
  id: string,
  rows: string[][],
  title?: string,
  options?: BoqImportOptions,
) {
  return applyBoqImport(id, stampAppendSheetOnParsedLines(parseBoqFromRows(rows, title), options), options);
}

export function importBoqWorkbookIntoTender(
  id: string,
  sheets: WorkbookSheetRows[],
  title?: string,
  options?: BoqImportOptions,
) {
  const parsed = stripTakeoffPipeMetresFromSupplierSheets(parseBoqFromWorkbookSheets(sheets, title));
  return applyBoqImport(id, parsed, options);
}

/** Wipe imported BoQ lines so the office can start a fresh import. Does not touch document uploads. */
export function clearBoqFromTender(id: string) {
  const existing = getTender(id);
  if (!existing) throw new Error("Tender not found.");
  return updateTender(id, {
    boqTitle: "",
    boqLines: [],
    bidValue: 0,
    tenderSum: 0,
  });
}

function usedBoqSheetNames(lines: TenderBoqLine[]): Set<string> {
  const used = new Set<string>();
  for (const line of lines) {
    const sheet = line.sheet?.trim();
    if (sheet) used.add(sheet);
  }
  return used;
}

function stampUnsheetedLines(lines: TenderBoqLine[], homeLabel: string): TenderBoqLine[] {
  const used = usedBoqSheetNames(lines);
  if (lines.some((line) => Boolean(line.sheet?.trim()))) return lines;
  if (!lines.length) return lines;
  const home = nextUniqueBoqSheetName(homeLabel, used);
  return lines.map((line) => ({
    ...line,
    sheet: home,
    section: line.section || home,
  }));
}

function persistBoqLines(tenderId: string, boqLines: TenderBoqLine[]) {
  const normalized = normalizeBoqLines(boqLines);
  const boqTotal = computeBoqTotal(normalized);
  return updateTender(tenderId, {
    boqLines: normalized,
    bidValue: boqTotal,
    tenderSum: boqTotal,
  });
}

/** Append a blank measured line on a sheet (or the end of an unsheeted bill). */
export function addBoqMeasuredLine(
  tenderId: string,
  options?: {
    sheet?: string | null;
    ref?: string;
    description?: string;
    quantity?: number | null;
    unit?: string;
  },
) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");

  const sheetKey = options?.sheet?.trim() || "";
  const line: TenderBoqLine = {
    id: uid("boq"),
    kind: "measured",
    ref: options?.ref?.trim() || undefined,
    description: options?.description?.trim() || "New item",
    quantity: options?.quantity === undefined ? 1 : options.quantity,
    unit: options?.unit?.trim() || "nr",
    rate: null,
    value: null,
    sheet: sheetKey || undefined,
    section: sheetKey || undefined,
  };

  return persistBoqLines(tenderId, [...existing.boqLines, line]);
}

/** Remove one or more BoQ lines by id (headers, notes, measured). */
export function deleteBoqLines(tenderId: string, lineIds: string[]) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const remove = new Set(lineIds.filter(Boolean));
  if (!remove.size) throw new Error("No BoQ lines selected to delete.");
  const boqLines = existing.boqLines.filter((line) => !remove.has(line.id));
  return persistBoqLines(tenderId, boqLines);
}

function resolveBoqSheetKey(lines: TenderBoqLine[], name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const used = usedBoqSheetNames(lines);
  if (used.has(trimmed)) return trimmed;
  for (const key of used) {
    if (key.toLowerCase() === trimmed.toLowerCase()) return key;
  }
  return null;
}

function stampBoqLineOntoSheet(line: TenderBoqLine, fromKey: string, toKey: string): TenderBoqLine {
  const from = fromKey.trim();
  const to = toKey.trim();
  const section = (line.section || "").trim();
  const sheet = (line.sheet || "").trim();
  const echoedHome = !section || section === from || section === sheet;
  const fromLayer = layerSectionFromSheetName(from);
  const toLayer = layerSectionFromSheetName(to);

  let nextSection = line.section;
  if (echoedHome) {
    if (fromLayer && !toLayer) nextSection = fromLayer;
    else if (fromLayer && toLayer) nextSection = toLayer;
    else nextSection = to;
  }

  const next: TenderBoqLine = {
    ...line,
    sheet: to,
    section: nextSection,
  };
  if (line.kind === "header" && echoedHome && nextSection && nextSection !== to) {
    next.description = nextSection;
  }
  return next;
}

/**
 * Move selected BoQ lines onto another workbook tab (existing or new).
 * Unique ids are kept. Other sheets are left in place — only `sheet` (and echoed
 * section labels) change on the moved rows, then they are appended after the dest tab.
 */
export function moveBoqLinesToSheet(
  tenderId: string,
  lineIds: string[],
  targetName: string,
  options?: {
    sourceSheet?: string | null;
    mergeWholeSource?: boolean;
    removeEmptySource?: boolean;
  },
): { tender: Tender; sheetKey: string; movedCount: number } {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const destInput = targetName.trim();
  if (!destInput) throw new Error("Sheet name required.");

  const sourceKey = options?.sourceSheet?.trim() || "";
  const requested = new Set(lineIds.filter(Boolean));
  const moveIds = new Set<string>();

  if (options?.mergeWholeSource) {
    const home = sourceKey || [...new Set(
      existing.boqLines.filter((line) => requested.has(line.id)).map((line) => (line.sheet || "").trim()),
    )].find(Boolean) || "";
    if (!home) throw new Error("Sheet not found.");
    for (const line of existing.boqLines) {
      if ((line.sheet || "").trim() !== home) continue;
      moveIds.add(line.id);
    }
  } else {
    for (const line of existing.boqLines) {
      if (!requested.has(line.id)) continue;
      if (isBoqSheetEchoHeader(line)) continue;
      moveIds.add(line.id);
    }
  }

  if (!moveIds.size) throw new Error("No BoQ lines selected to move.");

  const existingDest = resolveBoqSheetKey(existing.boqLines, destInput);
  const sheetKey =
    existingDest || nextUniqueBoqSheetName(destInput, usedBoqSheetNames(existing.boqLines));

  const moving: TenderBoqLine[] = [];
  const staying: TenderBoqLine[] = [];
  const sourceKeys = new Set<string>();
  for (const line of existing.boqLines) {
    if (!moveIds.has(line.id)) {
      staying.push(line);
      continue;
    }
    const from = (line.sheet || "").trim();
    if (from) sourceKeys.add(from);
    if (from === sheetKey) {
      staying.push(line);
      continue;
    }
    moving.push(stampBoqLineOntoSheet(line, from, sheetKey));
  }

  if (!moving.length) throw new Error("Those lines are already on that sheet.");

  const sourceLayer = [...sourceKeys]
    .map((key) => layerSectionFromSheetName(key))
    .find(Boolean);
  const destLayer = layerSectionFromSheetName(sheetKey);
  if (sourceLayer && !destLayer) {
    const destHasLayerHeader = staying.some(
      (line) =>
        (line.sheet || "").trim() === sheetKey
        && line.kind === "header"
        && (line.section || line.description || "").trim() === sourceLayer,
    );
    const batchHasLayerHeader = moving.some(
      (line) =>
        line.kind === "header" && (line.section || line.description || "").trim() === sourceLayer,
    );
    if (!destHasLayerHeader && !batchHasLayerHeader) {
      moving.unshift({
        id: uid("boq"),
        kind: "header",
        description: sourceLayer,
        sheet: sheetKey,
        section: sourceLayer,
      });
    }
  }

  let kept = staying;
  if (options?.removeEmptySource) {
    const remainingBySheet = new Map<string, TenderBoqLine[]>();
    for (const line of kept) {
      const key = (line.sheet || "").trim();
      if (!key) continue;
      const list = remainingBySheet.get(key) || [];
      list.push(line);
      remainingBySheet.set(key, list);
    }
    const dropKeys = new Set<string>();
    const candidates = sourceKey ? [sourceKey] : [...sourceKeys];
    for (const key of candidates) {
      if (!key || key === sheetKey) continue;
      const remain = remainingBySheet.get(key) || [];
      if (!remain.length || remain.every((line) => isBoqSheetEchoHeader(line))) {
        dropKeys.add(key);
      }
    }
    if (dropKeys.size) {
      kept = kept.filter((line) => !dropKeys.has((line.sheet || "").trim()));
    }
  }

  let insertAt = kept.length;
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    if ((kept[i]?.sheet || "").trim() === sheetKey) {
      insertAt = i + 1;
      break;
    }
  }
  const boqLines = [...kept.slice(0, insertAt), ...moving, ...kept.slice(insertAt)];
  return { tender: persistBoqLines(tenderId, boqLines), sheetKey, movedCount: moving.length };
}

/** Move selected (or whole source tab) onto dest, then drop an emptied source tab. */
export function mergeBoqLinesIntoSheet(
  tenderId: string,
  options: {
    lineIds?: string[];
    targetName: string;
    sourceSheet?: string | null;
    mergeWholeSource?: boolean;
  },
) {
  return moveBoqLinesToSheet(tenderId, options.lineIds || [], options.targetName, {
    sourceSheet: options.sourceSheet,
    mergeWholeSource: Boolean(options.mergeWholeSource),
    removeEmptySource: true,
  });
}

/**
 * Move selected BoQ lines under a different section header on the same sheet.
 * Lines are removed from their current position and inserted after the last
 * existing line in the target section (or directly after the section header if
 * it has no lines yet).  If `targetSectionId` is `"__new__"`, a new header is
 * created with `newSectionName`.
 */
export function moveBoqLinesToSection(
  tenderId: string,
  lineIds: string[],
  options: {
    sheetKey?: string | null;
    targetSectionId: string;
    newSectionName?: string;
  },
): { tender: Tender; movedCount: number; sectionLabel: string } {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");

  const sheetKey = (options.sheetKey || "").trim() || null;
  const requested = new Set(lineIds.filter(Boolean));
  if (!requested.size) throw new Error("No lines selected.");

  // Validate all requested lines exist and belong to the active sheet.
  const movingIds = new Set<string>();
  for (const line of existing.boqLines) {
    if (!requested.has(line.id)) continue;
    if (line.kind === "header") continue; // don't move headers
    if (sheetKey && (line.sheet || "").trim() !== sheetKey) continue;
    movingIds.add(line.id);
  }
  if (!movingIds.size) throw new Error("No movable lines selected on this sheet.");

  let targetHeaderId: string;
  let sectionLabel: string;
  let newHeader: TenderBoqLine | null = null;

  if (options.targetSectionId === "__new__") {
    const name = (options.newSectionName || "").trim();
    if (!name) throw new Error("Section name required.");
    newHeader = {
      id: uid("boq"),
      kind: "header",
      description: name,
      sheet: sheetKey || undefined,
      section: name,
    };
    targetHeaderId = newHeader.id;
    sectionLabel = name;
  } else {
    const header = existing.boqLines.find(
      (line) => line.id === options.targetSectionId && line.kind === "header",
    );
    if (!header) throw new Error("Target section header not found.");
    targetHeaderId = header.id;
    sectionLabel = (header.section || header.description || "").trim();
  }

  // Pull lines out, update their section stamp, then splice them after target section.
  const moving: TenderBoqLine[] = [];
  const rest: TenderBoqLine[] = [];
  for (const line of existing.boqLines) {
    if (movingIds.has(line.id)) {
      moving.push({ ...line, section: sectionLabel });
    } else {
      rest.push(line);
    }
  }

  // If creating a new header, append it at the end of the sheet.
  if (newHeader) {
    let insertAt = rest.length;
    if (sheetKey) {
      for (let i = rest.length - 1; i >= 0; i -= 1) {
        if ((rest[i]?.sheet || "").trim() === sheetKey) {
          insertAt = i + 1;
          break;
        }
      }
    }
    rest.splice(insertAt, 0, newHeader);
  }

  // Find the insert point: after the last line belonging to the target section.
  const headerIdx = rest.findIndex((line) => line.id === targetHeaderId);
  let insertAt = headerIdx + 1;
  for (let i = headerIdx + 1; i < rest.length; i += 1) {
    const line = rest[i]!;
    if (line.kind === "header") break; // next section
    if (sheetKey && (line.sheet || "").trim() !== sheetKey) break;
    insertAt = i + 1;
  }

  const boqLines = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  return {
    tender: persistBoqLines(tenderId, boqLines),
    movedCount: moving.length,
    sectionLabel,
  };
}

/**
 * Add an empty workbook sheet tab (echo header so the tab appears).
 * Unsheeted existing lines are stamped onto “Issued BoQ” first when introducing tabs.
 */
export function addBoqSheetTab(tenderId: string, name?: string) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");

  let base = stampUnsheetedLines(existing.boqLines, "Issued BoQ");
  const used = usedBoqSheetNames(base);
  const sheet = nextUniqueBoqSheetName(name?.trim() || "Sheet", used);
  const header: TenderBoqLine = {
    id: uid("boq"),
    kind: "header",
    description: sheet,
    sheet,
    section: sheet,
  };
  const tender = persistBoqLines(tenderId, [...base, header]);
  return { tender, sheetKey: sheet };
}

/** Rename a workbook sheet tab across all lines on that sheet. */
export function renameBoqSheetTab(tenderId: string, fromKey: string, toName: string) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const from = fromKey.trim();
  if (!from) throw new Error("Sheet name required.");
  const desired = toName.trim();
  if (!desired) throw new Error("New sheet name required.");

  const onSheet = existing.boqLines.filter((line) => (line.sheet || "").trim() === from);
  if (!onSheet.length) throw new Error("Sheet not found.");

  const used = usedBoqSheetNames(
    existing.boqLines.filter((line) => (line.sheet || "").trim() !== from),
  );
  const nextName = nextUniqueBoqSheetName(desired, used);
  if (nextName === from) {
    return { tender: existing, sheetKey: from };
  }

  const boqLines = existing.boqLines.map((line) => {
    if ((line.sheet || "").trim() !== from) return line;
    const echoes =
      line.kind === "header" &&
      ((line.section || "").trim() === from || (line.description || "").trim() === from);
    return {
      ...line,
      sheet: nextName,
      section: echoes ? nextName : line.section === from ? nextName : line.section,
      description: echoes ? nextName : line.description,
    };
  });
  return { tender: persistBoqLines(tenderId, boqLines), sheetKey: nextName };
}

/** Remove every line on a workbook sheet tab. */
export function deleteBoqSheetTab(tenderId: string, sheetKey: string) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const key = sheetKey.trim();
  if (!key) throw new Error("Sheet name required.");
  const remaining = existing.boqLines.filter((line) => (line.sheet || "").trim() !== key);
  if (remaining.length === existing.boqLines.length) throw new Error("Sheet not found.");
  return persistBoqLines(tenderId, remaining);
}

function cell(row: string[], index: number) {
  return (row[index] || "").trim();
}

function parseOptionalPercent(value: string) {
  const cleaned = value.replace(/%/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalMoney(value: string) {
  const cleaned = value.replace(/£/g, "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTrackerStatus(value: string): TenderStatus {
  const trimmed = value.trim();
  if (TENDER_STATUSES.includes(trimmed as TenderStatus)) return trimmed as TenderStatus;
  const lower = trimmed.toLowerCase();
  if (lower.includes("progress")) return "In Progress";
  if (lower.includes("review")) return "Needs Reviewed";
  if (lower.includes("won")) return "Won";
  if (lower.includes("lost")) return "Lost";
  if (lower.includes("sent")) return "Sent";
  if (lower.includes("not")) return "Not Started";
  return "Not Started";
}

function excelSerialToIso(value: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 20000 && asNumber < 80000) {
    // Excel serial date
    const utc = Date.UTC(1899, 11, 30) + Math.round(asNumber) * 86_400_000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return undefined;
}

/** Import / merge rows from the EWG Tender Tracker spreadsheet shape. */
export function importTrackerRows(rows: string[][]) {
  if (!rows.length) return { created: 0, updated: 0, tenders: listTenders() };

  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => /opportunity name/i.test(cell)) && row.some((cell) => /^client$/i.test(cell)),
  );
  const start = headerIndex >= 0 ? headerIndex : 0;
  const header = (rows[start] || []).map((item) => item.toLowerCase());
  const col = (...names: string[]) => {
    for (const name of names) {
      const index = header.findIndex((cell) => cell === name || cell.includes(name));
      if (index >= 0) return index;
    }
    return -1;
  };

  const idx = {
    id: col("tender id", "id"),
    name: col("opportunity name", "opportunity"),
    client: col("client"),
    category: col("category"),
    area: col("area"),
    deadline: col("submission deadline", "deadline"),
    status: col("status"),
    owner: col("owner"),
    bid: col("bid value", "value"),
    win: col("win probability", "probability"),
    materials: col("materials", "alert") >= 0 && header.includes("materials ") ? header.indexOf("materials ") : -1,
  };
  // materials notes often live in column O without a stable header — fall back to index 14
  const materialsIndex = idx.materials >= 0 ? idx.materials : 14;

  let created = 0;
  let updated = 0;
  const current = listTenders();
  for (let i = start + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const name = idx.name >= 0 ? cell(row, idx.name) : "";
    const client = idx.client >= 0 ? cell(row, idx.client) : "";
    if (!name || !client) continue;
    if (/^sent$/i.test(name) && !client) continue;

    const externalId = idx.id >= 0 ? cell(row, idx.id) : "";
    const existing =
      (externalId ? current.find((tender) => tender.externalId === externalId) : undefined) ||
      current.find(
        (tender) =>
          tender.name.toLowerCase() === name.toLowerCase() && tender.client.toLowerCase() === client.toLowerCase(),
      );

    const deadlineRaw = idx.deadline >= 0 ? cell(row, idx.deadline) : "";
    const statusRaw = idx.status >= 0 ? cell(row, idx.status) : "";
    const bidRaw = idx.bid >= 0 ? cell(row, idx.bid) : "";
    const winRaw = idx.win >= 0 ? cell(row, idx.win) : "";
    const materialsNote = cell(row, materialsIndex);

    const payload = {
      id: existing?.id,
      externalId: externalId || existing?.externalId,
      name,
      client,
      category: (idx.category >= 0 ? cell(row, idx.category) : "") || existing?.category || "Plumbing",
      area: (idx.area >= 0 ? cell(row, idx.area) : "") || existing?.area || "Aberdeen",
      submissionDeadline: deadlineRaw ? excelSerialToIso(deadlineRaw) : existing?.submissionDeadline,
      status: statusRaw ? normalizeTrackerStatus(statusRaw) : existing?.status || ("Not Started" as TenderStatus),
      owner: (idx.owner >= 0 ? cell(row, idx.owner) : "") || existing?.owner || "",
      bidValue: bidRaw ? parseOptionalMoney(bidRaw) : existing?.bidValue || 0,
      tenderSum: bidRaw ? parseOptionalMoney(bidRaw) : existing?.tenderSum || 0,
      winProbability: winRaw ? parseOptionalPercent(winRaw) : existing?.winProbability,
      materialsNote: materialsNote || existing?.materialsNote || "",
      boqLines: existing?.boqLines || [],
      documents: existing?.documents || [],
      qualifications: existing?.qualifications,
      daywork: existing?.daywork,
    };

    const saved = upsertTender(payload);
    if (existing) {
      updated += 1;
      const index = current.findIndex((tender) => tender.id === saved.id);
      if (index >= 0) current[index] = saved;
    } else {
      created += 1;
      current.unshift(saved);
    }
  }

  return { created, updated, tenders: listTenders() };
}

export function updateBoqLine(tenderId: string, lineId: string, patch: Partial<TenderBoqLine>) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  // Only the first matching id — duplicate ids must never rewrite other sheet tabs.
  let matched = false;
  const boqLines = existing.boqLines.map((line) => {
    if (matched || line.id !== lineId) return line;
    matched = true;
    const next: TenderBoqLine = { ...line, ...patch };
    // Never let a cell edit reassign the workbook sheet tab.
    next.sheet = line.sheet;
    delete next.excluded;
    if (next.kind === "measured") {
      if (patch.rate === null) {
        next.rate = null;
        if (patch.value === undefined) next.value = null;
        if (patch.pricingSource === undefined) next.pricingSource = undefined;
      } else if (
        typeof next.rate === "number" &&
        typeof next.quantity === "number" &&
        (patch.rate !== undefined || patch.quantity !== undefined)
      ) {
        next.value = roundMoney(next.rate * next.quantity);
        if (patch.rate !== undefined && patch.pricingSource === undefined) {
          next.pricingSource = "manual";
        }
      } else if (patch.rate !== undefined && patch.pricingSource === undefined) {
        next.pricingSource = "manual";
      }
    }
    return next;
  });
  const boqTotal = computeBoqTotal(boqLines);
  return updateTender(tenderId, {
    boqLines,
    bidValue: boqTotal,
    tenderSum: boqTotal,
  });
}

/** Apply Blake budget / rate-library guide rates onto blank (or refreshable) BoQ lines. */
export async function applyBlakeBudgetPricesToTender(
  tenderId: string,
  options: {
    forceRefresh?: boolean;
    /** When set, only these measured line ids are offered to Blake / the library. */
    lineIds?: string[];
    onProgress?: (progress: {
      stage: "library" | "blake" | "done";
      message: string;
      chunkIndex?: number;
      chunkTotal?: number;
      pricedSoFar?: number;
      openSoFar?: number;
    }) => void;
    signal?: AbortSignal;
  } = {},
) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  if (!existing.boqLines.some((line) => line.kind === "measured")) {
    throw new Error("Import a BoQ first — no measured lines to price.");
  }

  const { budgetPriceTenderBoqWithBlake } = await import("@/lib/tender-boq-blake-prices");
  const priced = await budgetPriceTenderBoqWithBlake(existing.boqLines, {
    forceRefresh: options.forceRefresh,
    lineIds: options.lineIds,
    context: `${existing.name} · ${existing.client} · ${existing.category} · ${existing.area}`,
    onProgress: options.onProgress,
    signal: options.signal,
  });

  const boqTotal = computeBoqTotal(priced.lines);
  const tender = updateTender(tenderId, {
    boqLines: priced.lines,
    bidValue: boqTotal,
    tenderSum: boqTotal,
  });

  return { tender, priced };
}

export function addTenderDocument(
  tenderId: string,
  document: Omit<TenderDocument, "id" | "uploadedAt"> & {
    id?: string;
    uploadedAt?: string;
  },
) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const folders = existing.documentFolders || [];
  let folderId = document.folderId?.trim() || undefined;
  let kind = document.kind;
  if (folderId) {
    if (isTenderDocumentKind(folderId)) {
      kind = folderId;
      folderId = undefined;
    } else {
      const folder = folders.find((item) => item.id === folderId);
      if (!folder) throw new Error("Folder not found on this tender.");
      kind = resolveTenderDocumentFolderKind(folders, folderId);
    }
  }
  const nextDoc: TenderDocument = {
    id: document.id || uid("tdoc"),
    kind,
    name: document.name,
    mimeType: document.mimeType,
    url: document.url,
    uploadedAt: document.uploadedAt || nowIso(),
    note: document.note,
    folderId,
  };
  return updateTender(tenderId, {
    documents: [nextDoc, ...existing.documents.filter((item) => item.id !== nextDoc.id)],
  });
}

export function moveTenderDocument(
  tenderId: string,
  documentId: string,
  target: { kind?: TenderDocumentKind; folderId?: string | null },
) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const folders = existing.documentFolders || [];
  const targetDoc = existing.documents.find((doc) => doc.id === documentId);
  if (!targetDoc) throw new Error("Document not found on this tender.");

  let folderId = typeof target.folderId === "string" && target.folderId.trim() ? target.folderId.trim() : undefined;
  let kind = target.kind || targetDoc.kind;

  if (folderId) {
    if (isTenderDocumentKind(folderId)) {
      kind = folderId;
      folderId = undefined;
    } else {
      const folder = folders.find((item) => item.id === folderId);
      if (!folder) throw new Error("Folder not found on this tender.");
      kind = resolveTenderDocumentFolderKind(folders, folderId);
    }
  } else if (target.kind) {
    kind = target.kind;
    folderId = undefined;
  }

  return updateTender(tenderId, {
    documents: existing.documents.map((doc) =>
      doc.id === documentId ? { ...doc, kind, folderId } : doc,
    ),
  });
}

export function addTenderDocumentFolder(
  tenderId: string,
  input: { name: string; parentId?: string | null },
) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Folder name is required.");

  const parentId = input.parentId?.trim() || null;
  const folders = existing.documentFolders || [];

  if (parentId) {
    if (isTenderDocumentKind(parentId)) {
      // Nesting directly under a built-in kind is depth 1 — always allowed.
    } else {
      const parent = folders.find((folder) => folder.id === parentId);
      if (!parent) throw new Error("Parent folder not found.");
      const parentDepth = tenderDocumentFolderDepth(folders, parent.id);
      if (parentDepth >= TENDER_DOCUMENT_FOLDER_MAX_DEPTH) {
        throw new Error("Folders can only nest two levels under a document type.");
      }
    }
  }

  const duplicate = folders.some(
    (folder) =>
      folder.name.toLowerCase() === name.toLowerCase() &&
      (folder.parentId || null) === parentId,
  );
  if (duplicate) throw new Error("A folder with that name already exists here.");

  const next: TenderDocumentFolder = {
    id: uid("tfolder"),
    name,
    parentId,
  };
  return updateTender(tenderId, {
    documentFolders: [...folders, next],
  });
}

export function removeTenderDocumentFolder(tenderId: string, folderId: string) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const folders = existing.documentFolders || [];
  const target = folders.find((folder) => folder.id === folderId);
  if (!target) throw new Error("Folder not found on this tender.");

  const childFolders = folders.filter((folder) => folder.parentId === folderId);
  if (childFolders.length) {
    throw new Error("Remove subfolders first.");
  }

  const parentId = target.parentId || null;
  const fallbackKind = resolveTenderDocumentFolderKind(folders, folderId);
  const documents = existing.documents.map((doc) => {
    if (doc.folderId !== folderId) return doc;
    // Move files up to the parent folder (or built-in kind root).
    if (parentId && !isTenderDocumentKind(parentId)) {
      return { ...doc, folderId: parentId, kind: resolveTenderDocumentFolderKind(folders, parentId) };
    }
    return {
      ...doc,
      folderId: undefined,
      kind: parentId && isTenderDocumentKind(parentId) ? parentId : fallbackKind,
    };
  });

  return updateTender(tenderId, {
    documentFolders: folders.filter((folder) => folder.id !== folderId),
    documents,
  });
}

export function removeTenderDocument(tenderId: string, documentId: string) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const target = existing.documents.find((doc) => doc.id === documentId);
  if (!target) {
    throw new Error("Document not found on this tender.");
  }
  // Drop the underlying upload when present so the file does not linger after Remove.
  deleteRecordDocumentByFileUrl(target.url);
  return updateTender(tenderId, {
    documents: existing.documents.filter((doc) => doc.id !== documentId),
  });
}

/**
 * Mark Won → Pending job — same shape as quote→job.
 * Creates the job + tender link only. Never loads BoQ lines, never writes cost centres,
 * never copies PDFs (use Rebuild / Sync drawings afterwards).
 */
export function convertTenderToPendingJob(tenderId: string) {
  // Lean meta only — getTender/attachBoq is what OOMed Mark Won on volume Bills.
  const tenderMeta = readStoreRaw().tenders.find((row) => row.id === tenderId);
  if (!tenderMeta) throw new Error("Tender not found.");
  if (tenderMeta.convertedJobId) {
    const linked = getJob(tenderMeta.convertedJobId);
    if (linked) {
      // Already linked — ensure status is Won without creating a second job.
      const ensured =
        tenderMeta.status === "Won"
          ? tenderMeta
          : patchTenderJobLink(tenderMeta.id, { status: "Won" });
      return {
        tender: leanTenderForClient(ensured),
        job: null as ReturnType<typeof createJob> | null,
        alreadyConverted: true as const,
        recreated: false as const,
        jobSections: [] as ReturnType<typeof applyTenderBoqStructureToJob>["sections"],
        jobCostCentres: [] as ReturnType<typeof applyTenderBoqStructureToJob>["costCentres"],
        documentsCopied: 0,
        documentsSkipped: 0,
      };
    }
    // Stale link (job deleted / missing) — fall through and create a fresh Pending job.
  }
  const summary = readBoqRebuildSummary(tenderMeta.id);
  const value =
    Number(tenderMeta.tenderSum) ||
    Number(tenderMeta.bidValue) ||
    Number(summary?.totalSell) ||
    0;
  const siteLabel =
    [tenderMeta.area, tenderMeta.materialsNote?.trim()].filter(Boolean).join(" — ") || "Site to be confirmed";
  const job = createJob({
    clientId: tenderMeta.clientId,
    customer: tenderMeta.client,
    site: siteLabel,
    description: `${tenderMeta.name}${tenderMeta.boqTitle ? ` — ${tenderMeta.boqTitle}` : ""}`.trim(),
    manager: tenderMeta.owner || "Unassigned",
    status: "Pending",
    value,
    next: "Won tender — schedule and start checks",
    due: tenderMeta.submissionDeadline || new Date().toISOString().slice(0, 10),
    sourceTenderId: tenderMeta.id,
    sourceTenderName: tenderMeta.name,
  });
  const recreated = Boolean(tenderMeta.convertedJobId);
  const updated = patchTenderJobLink(tenderMeta.id, {
    status: "Won",
    convertedJobId: job.id,
    convertedJobRef: job.ref,
    tenderSum: value,
    bidValue: value,
  });
  return {
    tender: leanTenderForClient(updated),
    job,
    alreadyConverted: false as const,
    recreated,
    jobSections: [],
    jobCostCentres: [],
    documentsCopied: 0,
    documentsSkipped: 0,
  };
}

/**
 * Crash-proof rebuild — never loads BoQ line arrays, never opens tenders meta.
 * Uses saved floor/service summary when present, otherwise the job value / summary total.
 */
function rebuildJobStructureFromJobOnly(job: NonNullable<ReturnType<typeof getJob>>) {
  const tenderId = String(job.sourceTenderId || "");
  const summary = tenderId ? readBoqRebuildSummary(tenderId) : null;
  const total = summary?.totalSell || Number(job.value) || 0;
  const built =
    summary && summary.buckets.length
      ? buildJobStructureFromBoqSummary(job, summary)
      : buildJobStructureFromTenderTotal(job, total);
  return applyBuiltTenderStructureToJob(job, built, { replace: true });
}

/** @deprecated Prefer rebuildJobStructureFromJobOnly — kept for tender-id rebuild path. */
function rebuildJobStructureWithoutLoadingBoq(
  job: NonNullable<ReturnType<typeof getJob>>,
  tenderMeta: Tender,
) {
  const summary = readBoqRebuildSummary(tenderMeta.id);
  const total = Number(tenderMeta.tenderSum) || Number(tenderMeta.bidValue) || summary?.totalSell || Number(job.value) || 0;
  const built =
    summary && summary.buckets.length
      ? buildJobStructureFromBoqSummary(job, summary)
      : buildJobStructureFromTenderTotal(job, total);
  return applyBuiltTenderStructureToJob(job, built, { replace: true });
}

/** Rebuild floor sections + service cost centres on the linked Won job from current BoQ. */
export function rebuildTenderJobCostCentres(tenderId: string) {
  const tenderMeta = readStoreRaw().tenders.find((row) => row.id === tenderId);
  if (!tenderMeta) throw new Error("Tender not found.");
  if (!tenderMeta.convertedJobId) {
    throw new Error("This tender has no linked job yet — use Create job from this tender first.");
  }
  const job = getJob(tenderMeta.convertedJobId);
  if (!job) {
    throw new Error("Linked job is missing — recreate the job from this tender first.");
  }
  // Structure from summary/job only — never load BoQ lines.
  const structure = rebuildJobStructureFromJobOnly(job);
  const nextValue = structure.totalSell || Number(tenderMeta.tenderSum) || Number(tenderMeta.bidValue) || job.value;
  // Link patch is best-effort — never fail the rebuild if tenders meta is fat/unwritable.
  let updatedTender = tenderMeta;
  try {
    const linkOk =
      tenderMeta.convertedJobId === structure.job.id &&
      tenderMeta.convertedJobRef === structure.job.ref &&
      tenderMeta.status === "Won" &&
      moneyClose(tenderMeta.tenderSum, nextValue) &&
      moneyClose(tenderMeta.bidValue, nextValue);
    if (!linkOk) {
      updatedTender = patchTenderJobLink(tenderMeta.id, {
        status: "Won",
        convertedJobId: structure.job.id,
        convertedJobRef: structure.job.ref,
        tenderSum: nextValue,
        bidValue: nextValue,
      });
    }
  } catch {
    updatedTender = tenderMeta;
  }
  console.info(`[hubflo] ${LEAN_REBUILD_NOTICE}`, {
    path: "rebuildTenderJobCostCentres",
    tenderId,
    jobId: structure.job.id,
  });
  return {
    tender: leanTenderForClient(updatedTender),
    job: getJob(structure.job.id) || structure.job,
    jobSections: structure.sections,
    jobCostCentres: leanCentresForTransport(structure.job.id, structure.costCentres) as typeof structure.costCentres,
    documentsCopied: 0,
    documentsSkipped: 0,
    usedSummary: Boolean(readBoqRebuildSummary(tenderMeta.id)?.buckets?.length),
    notice: LEAN_REBUILD_NOTICE,
  };
}

const SOURCE_TENDER_DOC_LINK_PREFIX = "sourceTenderDoc:";

function jobFolderIdForTenderDocument(
  tender: Tender,
  doc: { kind: TenderDocumentKind; folderId?: string },
): string {
  const kind = doc.folderId
    ? resolveTenderDocumentFolderKind(tender.documentFolders || [], doc.folderId)
    : doc.kind;
  switch (kind) {
    case "drawing":
      return "drawings";
    case "issued-boq":
    case "priced-boq":
      return "bill-of-quantities";
    case "supplier-quote":
      return "supplier-quotes";
    case "specification":
    case "form-of-tender":
      return "forms-certificates";
    default:
      return "private-office";
  }
}

function tenderDocumentDisplayName(tender: Tender, doc: Tender["documents"][number]) {
  const folders = tender.documentFolders || [];
  const setLabel =
    doc.kind === "drawing"
      ? tenderDrawingSetLabel(folders, doc.folderId)
      : doc.folderId
        ? tenderDocumentFolderPathLabel(folders, doc.folderId)
        : "";
  if (setLabel && setLabel !== "Drawings" && !doc.name.startsWith(`${setLabel} /`)) {
    return `${setLabel} / ${doc.name}`;
  }
  return doc.name;
}

export type CopyTenderDocumentsToJobResult = {
  copied: number;
  skipped: number;
  skippedMissing: number;
  skippedDuplicate: number;
  tenderDocumentCount: number;
};

/** Soft caps so Mark Won / Sync drawings cannot load every PDF into RAM at once. */
const TENDER_DOC_COPY_MAX_FILE_BYTES = 8 * 1024 * 1024;
const TENDER_DOC_COPY_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const TENDER_DOC_COPY_MAX_FILES = 20;

/** Copy tender Documents (drawings, specs, BoQs) onto the linked job record-documents hub. */
export function copyTenderDocumentsToJob(
  tender: Tender,
  job: Pick<{ id: string; ref: string }, "id" | "ref">,
): CopyTenderDocumentsToJobResult {
  const empty: CopyTenderDocumentsToJobResult = {
    copied: 0,
    skipped: 0,
    skippedMissing: 0,
    skippedDuplicate: 0,
    tenderDocumentCount: tender.documents?.length || 0,
  };
  if (!job.ref || !tender.documents?.length) return empty;

  const existing = listRecordDocuments("job", job.ref);
  const existingBySource = new Set(
    existing
      .map((row) => {
        const match = String(row.linkedTo || "").match(/sourceTenderDoc:([^\s|]+)/);
        return match?.[1] || "";
      })
      .filter(Boolean),
  );
  const existingChecksum = new Set(existing.map((row) => row.checksum).filter(Boolean));
  const existingNames = new Set(existing.map((row) => row.name));

  let copied = 0;
  let skippedMissing = 0;
  let skippedDuplicate = 0;
  let totalBytes = 0;

  for (const doc of tender.documents) {
    if (copied >= TENDER_DOC_COPY_MAX_FILES) {
      skippedMissing += 1;
      continue;
    }
    if (existingBySource.has(doc.id)) {
      skippedDuplicate += 1;
      continue;
    }
    const recordId = recordDocumentIdFromUrl(doc.url);
    const file = recordId ? readRecordDocumentFile(recordId) : null;
    if (!file?.bytes?.length) {
      skippedMissing += 1;
      continue;
    }
    if (file.bytes.length > TENDER_DOC_COPY_MAX_FILE_BYTES) {
      skippedMissing += 1;
      continue;
    }
    if (totalBytes + file.bytes.length > TENDER_DOC_COPY_MAX_TOTAL_BYTES) {
      skippedMissing += 1;
      continue;
    }
    if (existingChecksum.has(file.record.checksum)) {
      skippedDuplicate += 1;
      continue;
    }
    const displayName = tenderDocumentDisplayName(tender, doc);
    if (existingNames.has(displayName) || existingNames.has(doc.name)) {
      skippedDuplicate += 1;
      continue;
    }
    const folderId = jobFolderIdForTenderDocument(tender, doc);
    const setLabel =
      doc.kind === "drawing"
        ? tenderDrawingSetLabel(tender.documentFolders || [], doc.folderId)
        : "";
    const linkedTo = [
      job.ref,
      setLabel && setLabel !== "Drawings" ? setLabel : null,
      `${SOURCE_TENDER_DOC_LINK_PREFIX}${doc.id}`,
    ]
      .filter(Boolean)
      .join(" | ");
    saveUploadedRecordDocument({
      scope: "job",
      recordRef: job.ref,
      folderId,
      visibility: doc.kind === "drawing" ? "Engineer" : "Private",
      fileName: displayName,
      mimeType: doc.mimeType || file.record.type || "application/octet-stream",
      bytes: file.bytes,
      linkedTo,
    });
    copied += 1;
    totalBytes += file.bytes.length;
    existingNames.add(displayName);
    existingBySource.add(doc.id);
    if (file.record.checksum) existingChecksum.add(file.record.checksum);
  }

  return {
    copied,
    skipped: skippedMissing + skippedDuplicate,
    skippedMissing,
    skippedDuplicate,
    tenderDocumentCount: tender.documents.length,
  };
}

/** Sync drawings/docs for an already-converted job (repair path). */
export function syncTenderDocumentsToLinkedJob(tenderId: string) {
  const tender = getTender(tenderId);
  if (!tender) throw new Error("Tender not found.");
  if (!tender.convertedJobId) {
    throw new Error("This tender has no linked job yet — use Create job from this tender first.");
  }
  const job = getJob(tender.convertedJobId);
  if (!job) {
    throw new Error("Linked job is missing — recreate the job from this tender first.");
  }
  return {
    tender: leanTenderForClient(tender),
    job,
    ...copyTenderDocumentsToJob(tender, job),
  };
}

/**
 * Sync tender drawings onto a Core job by the job's sourceTenderId (Jobs UI path).
 * Does not require tender.convertedJobId — repairs stale/missing links.
 */
export function syncJobDocumentsFromSourceTender(jobIdOrRef: string) {
  const jobs = getJobs();
  const job =
    jobs.find((row) => row.id === jobIdOrRef) ||
    jobs.find((row) => row.ref === jobIdOrRef) ||
    getJob(jobIdOrRef);
  if (!job) throw new Error("Job not found.");
  if (!job.sourceTenderId) {
    throw new Error("This job is not linked to a tender.");
  }
  const tender = getTender(job.sourceTenderId);
  if (!tender) {
    throw new Error("Linked tender is missing — reopen the tender or clear the job link.");
  }
  if (tender.convertedJobId !== job.id) {
    patchTenderJobLink(tender.id, {
      convertedJobId: job.id,
      convertedJobRef: job.ref,
      status: tender.status === "Lost" ? tender.status : "Won",
    });
  }
  const linked = getTender(tender.id) || tender;
  return {
    tender: leanTenderForClient(linked),
    job,
    ...copyTenderDocumentsToJob(linked, job),
  };
}

/** Heal oversized/corrupt centres for a Core job (open-safe). Optionally keyed by job ref. */
export function healJobCostCentresForJob(jobIdOrRef: string) {
  const jobs = getJobs();
  const job =
    jobs.find((row) => row.id === jobIdOrRef) ||
    jobs.find((row) => row.ref === jobIdOrRef) ||
    getJob(jobIdOrRef);
  if (!job) throw new Error("Job not found.");
  const healed = healStoredJobCostCentres(job.id);
  // Do not copy drawings here — open-heal must stay cheap on 512MB Render.
  return {
    job,
    ...healed,
    centres: leanCentresForTransport(job.id, healed.centres) as typeof healed.centres,
    documents: null as CopyTenderDocumentsToJobResult | null,
  };
}

/**
 * Rebuild cost centres from the job's source tender (Jobs UI path).
 * Job-only: never opens nexa-tenders-v1, never patches tender meta, never loads BoQ lines.
 * Uses nexa-tender-boq-summary-v1:<id> when present, otherwise job.value as a single package.
 */
export function rebuildJobCostCentresFromSourceTender(jobIdOrRef: string) {
  const jobs = getJobs();
  const job =
    jobs.find((row) => row.id === jobIdOrRef) ||
    jobs.find((row) => row.ref === jobIdOrRef) ||
    getJob(jobIdOrRef);
  if (!job) throw new Error("Job not found.");
  if (!job.sourceTenderId) {
    throw new Error("This job is not linked to a tender.");
  }
  const summary = readBoqRebuildSummary(job.sourceTenderId);
  const structure = rebuildJobStructureFromJobOnly(job);
  const now = nowIso();
  // Stub tender for API shape — do not load/rewrite tenders meta (still OOMs when fat).
  const tenderStub: Tender = {
    id: job.sourceTenderId,
    name: job.sourceTenderName || "Linked tender",
    client: job.customer || "",
    category: "",
    area: "",
    status: "Won",
    owner: "",
    tenderSum: structure.totalSell || Number(job.value) || 0,
    bidValue: structure.totalSell || Number(job.value) || 0,
    convertedJobId: structure.job.id,
    convertedJobRef: structure.job.ref,
    qualifications: [],
    daywork: { labourPerHour: 0, materialsUpliftPercent: 0, plantUpliftPercent: 0 },
    boqLines: [],
    documents: [],
    createdAt: now,
    updatedAt: now,
  };
  console.info(`[hubflo] ${LEAN_REBUILD_NOTICE}`, {
    path: "rebuildJobCostCentresFromSourceTender",
    jobId: structure.job.id,
    tenderId: job.sourceTenderId,
    usedSummary: Boolean(summary?.buckets?.length),
  });
  return {
    tender: leanTenderForClient(tenderStub),
    job: getJob(structure.job.id) || structure.job,
    jobSections: structure.sections,
    jobCostCentres: leanCentresForTransport(structure.job.id, structure.costCentres) as typeof structure.costCentres,
    documentsCopied: 0,
    documentsSkipped: 0,
    usedSummary: Boolean(summary?.buckets?.length),
    notice: LEAN_REBUILD_NOTICE,
  };
}

function recordDocumentIdFromUrl(url?: string) {
  if (!url) return null;
  const match = url.match(/\/api\/record-documents\/([^/]+)\/file/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function safeTakeoffFileName(fileName: string) {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 140) || "drawing";
}

export type CopyTenderDrawingsResult = {
  copied: number;
  skipped: number;
  skippedMissing: number;
  skippedTooLarge: number;
  skippedBudget: number;
  labeled: number;
  tenderDrawingCount: number;
  takeoff: ReturnType<typeof getTakeoffProject>;
};

/**
 * Hide drawings synced from a Core tender (`sourceTenderDoc:` notes) and stash their markups.
 * Keeps PDF files on disk and local uploads active. Restored when that tender is linked again.
 */
export function clearTenderSourcedDrawingsFromTakeoff(
  takeoffId: string,
  options?: { archiveTenderId?: string; archiveTenderRef?: string },
): {
  removed: number;
  takeoff: ReturnType<typeof getTakeoffProject>;
} {
  const project = getTakeoffProject(takeoffId);
  if (!project) return { removed: 0, takeoff: undefined };

  const archiveTenderId = options?.archiveTenderId || project.sourceTenderId || "__unlinked__";
  const beforeCount = project.documents.filter((doc) => takeoffSourceTenderDocId(doc.notes)).length;
  if (!beforeCount) {
    return { removed: 0, takeoff: project };
  }

  const stashed = stashTenderSourcedDrawings(
    project,
    archiveTenderId,
    options?.archiveTenderRef || project.sourceTenderRef,
  );

  const takeoff = updateTakeoffProject(takeoffId, {
    documents: stashed.documents,
    ...(stashed.studio ? { studio: stashed.studio } : {}),
    studioTenderArchives: stashed.studioTenderArchives,
  });

  return {
    removed: beforeCount,
    takeoff: takeoff ?? stashed,
  };
}

/** Restore a stashed tender’s drawings + markups onto a takeoff (no-op if none). */
export function restoreTenderSourcedDrawingsToTakeoff(
  takeoffId: string,
  tenderId: string,
): {
  restored: boolean;
  documentCount: number;
  markupCount: number;
  takeoff: ReturnType<typeof getTakeoffProject>;
} {
  const project = getTakeoffProject(takeoffId);
  if (!project || !tenderId) {
    return { restored: false, documentCount: 0, markupCount: 0, takeoff: project };
  }

  const result = restoreTenderStudioArchive(project, tenderId);
  if (!result.restored) {
    return { restored: false, documentCount: 0, markupCount: 0, takeoff: project };
  }

  const takeoff = updateTakeoffProject(takeoffId, {
    documents: result.project.documents,
    ...(result.project.studio ? { studio: result.project.studio } : {}),
    studioTenderArchives: result.project.studioTenderArchives,
  });

  return {
    restored: true,
    documentCount: result.documentCount,
    markupCount: result.markupCount,
    takeoff: takeoff ?? result.project,
  };
}

/** Copy tender drawing files into a takeoff project (skip ones already transferred). */
export function copyTenderDrawingsToTakeoff(tender: Tender, takeoffId: string): CopyTenderDrawingsResult {
  const project = getTakeoffProject(takeoffId);
  const empty = {
    copied: 0,
    skipped: 0,
    skippedMissing: 0,
    skippedTooLarge: 0,
    skippedBudget: 0,
    labeled: 0,
    tenderDrawingCount: 0,
    takeoff: null as ReturnType<typeof getTakeoffProject>,
  };
  if (!project) return empty;

  const folders = tender.documentFolders || [];
  const drawings = tender.documents
    .filter((doc) => doc.kind === "drawing")
    .slice()
    .sort((a, b) => {
      const setA = tenderDrawingSetLabel(folders, a.folderId);
      const setB = tenderDrawingSetLabel(folders, b.folderId);
      return setA.localeCompare(setB) || a.name.localeCompare(b.name);
    });
  const tenderDrawingCount = drawings.length;
  if (!drawings.length) {
    return { ...empty, takeoff: project, tenderDrawingCount: 0 };
  }

  // Soft budget so large tenders stay honest in UI rather than silently truncating at 4.
  const MAX_COPY_BYTES_PER_FILE = 40 * 1024 * 1024;
  const MAX_COPY_TOTAL_BYTES = 250 * 1024 * 1024;

  const storageRoot = path.join(getServerStoreDirectory(), "takeoff-files", takeoffId);
  mkdirSync(storageRoot, { recursive: true });

  let documents = [...project.documents];
  const added = [];
  let skippedMissing = 0;
  let skippedTooLarge = 0;
  let skippedBudget = 0;
  let labeled = 0;
  let copiedBytes = documents
    .filter((row) => takeoffSourceTenderDocId(row.notes))
    .reduce((sum, row) => sum + (row.size || 0), 0);

  for (const doc of drawings) {
    const sourceTag = `${SOURCE_TENDER_DOC_PREFIX}${doc.id}`;
    const setLabel = tenderDrawingSetLabel(folders, doc.folderId);
    // Prefer exact source id match; fall back to filename-only match without a source tag.
    const bySource = documents.findIndex((row) => takeoffSourceTenderDocId(row.notes) === doc.id);
    const byNameOnly =
      bySource < 0
        ? documents.findIndex(
            (row) =>
              row.kind === "Drawing"
              && row.fileName === doc.name
              && !takeoffSourceTenderDocId(row.notes),
          )
        : -1;
    const matchIdx = bySource >= 0 ? bySource : byNameOnly;

    if (matchIdx >= 0) {
      const existing = documents[matchIdx]!;
      const nextNotes = withSourceFolderNote(
        existing.notes.includes(sourceTag) ? existing.notes : [...existing.notes, sourceTag],
        setLabel,
      );
      if (nextNotes.join("\n") !== existing.notes.join("\n")) {
        documents[matchIdx] = { ...existing, notes: nextNotes };
        labeled += 1;
      }
      continue;
    }

    const recordId = recordDocumentIdFromUrl(doc.url);
    const file = recordId ? readRecordDocumentFile(recordId) : null;
    if (!file?.bytes?.length) {
      skippedMissing += 1;
      continue;
    }
    if (file.bytes.length > MAX_COPY_BYTES_PER_FILE) {
      skippedTooLarge += 1;
      continue;
    }
    if (copiedBytes + file.bytes.length > MAX_COPY_TOTAL_BYTES) {
      skippedBudget += 1;
      continue;
    }

    const documentId = `takeoff-doc-${randomUUID()}`;
    const storedFileName = `${documentId}-${safeTakeoffFileName(doc.name)}`;
    const storageKey = ["takeoff-files", takeoffId, storedFileName].join("/");
    writeFileSync(path.join(storageRoot, storedFileName), file.bytes);
    copiedBytes += file.bytes.length;

    added.push({
      id: documentId,
      kind: "Drawing" as const,
      fileName: doc.name,
      mimeType: doc.mimeType || file.record.type || "application/pdf",
      size: file.bytes.length,
      storageKey,
      uploadedAt: nowIso(),
      status: "Uploaded" as const,
      notes: withSourceFolderNote(
        ["Copied from tender drawings on Send to Takeoff.", sourceTag],
        setLabel,
      ),
    });
  }

  const skipped = skippedMissing + skippedTooLarge + skippedBudget;
  if (!added.length && !labeled) {
    return {
      copied: 0,
      skipped,
      skippedMissing,
      skippedTooLarge,
      skippedBudget,
      labeled: 0,
      tenderDrawingCount,
      takeoff: project,
    };
  }

  documents = [...added, ...documents];
  const studio = project.studio
    ? {
        ...project.studio,
        activeDocumentId: project.studio.activeDocumentId || added[0]?.id,
        updatedAt: nowIso(),
      }
    : undefined;

  const takeoff = updateTakeoffProject(takeoffId, {
    documents,
    ...(studio ? { studio } : {}),
    status: project.status === "Draft" ? "In review" : project.status,
  });

  return {
    copied: added.length,
    skipped,
    skippedMissing,
    skippedTooLarge,
    skippedBudget,
    labeled,
    tenderDrawingCount,
    takeoff: takeoff ?? project,
  };
}

export function sendTenderToTakeoff(tenderId: string, options?: { createNew?: boolean }) {
  const tender = getTender(tenderId);
  if (!tender) throw new Error("Tender not found.");

  if (tender.linkedTakeoffId && !options?.createNew) {
    const existing = getTakeoffProject(tender.linkedTakeoffId);
    if (existing) {
      const synced = copyTenderDrawingsToTakeoff(tender, existing.id);
      return {
        tender,
        takeoff: synced.takeoff || existing,
        created: false as const,
        drawingsCopied: synced.copied,
      };
    }
  }

  const takeoff = createTakeoffProject({
    name: `${tender.name} · takeoff`,
    customer: tender.client,
    site: tender.area || "Site to confirm",
    description: [
      `Commercial takeoff for tender “${tender.name}”.`,
      tender.boqTitle ? `BoQ: ${tender.boqTitle}.` : "",
      tender.category ? `Category: ${tender.category}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    clientId: tender.clientId,
    sourceTenderId: tender.id,
    sourceTenderRef: tender.externalId || tender.name,
  });

  const synced = copyTenderDrawingsToTakeoff(tender, takeoff.id);
  const withDrawings = synced.takeoff || takeoff;

  const updated = updateTender(tenderId, {
    linkedTakeoffId: withDrawings.id,
    linkedTakeoffRef: withDrawings.reference,
  });

  return {
    tender: updated,
    takeoff: withDrawings,
    created: true as const,
    drawingsCopied: synced.copied,
  };
}

/** Bidirectional link: takeoff.sourceTender* ↔ tender.linkedTakeoff*. */
export function linkTakeoffToTender(
  takeoffId: string,
  takeoffRef: string,
  tenderId?: string | null,
) {
  const store = readStore();
  let changed = false;

  for (const tender of store.tenders) {
    if (tender.linkedTakeoffId === takeoffId && tender.id !== tenderId) {
      tender.linkedTakeoffId = undefined;
      tender.linkedTakeoffRef = undefined;
      tender.updatedAt = nowIso();
      changed = true;
    }
  }

  if (tenderId) {
    const tender = store.tenders.find((row) => row.id === tenderId);
    if (!tender) throw new Error("Tender not found.");
    if (tender.linkedTakeoffId !== takeoffId || tender.linkedTakeoffRef !== takeoffRef) {
      tender.linkedTakeoffId = takeoffId;
      tender.linkedTakeoffRef = takeoffRef;
      tender.updatedAt = nowIso();
      changed = true;
    }
  }

  if (changed) writeStore(store);
}

export function getTenderOptionList() {
  return listTenders().map((tender) => ({
    id: tender.id,
    name: tender.name,
    client: tender.client,
    status: tender.status,
    externalId: tender.externalId,
    linkedTakeoffId: tender.linkedTakeoffId,
  }));
}

export function archiveTenders(ids: string[]) {
  const updated = ids.map((id) => {
    const existing = getTender(id);
    if (!existing) return null;
    if (existing.status === "Won" && existing.convertedJobId) {
      return updateTender(id, { status: "Won" });
    }
    return updateTender(id, { status: "Lost" });
  }).filter(Boolean) as Tender[];
  return { updated, tenders: listTenders() };
}

export function deleteTenders(ids: string[]) {
  for (const id of ids) {
    try {
      deleteTender(id);
    } catch {
      // skip missing
    }
  }
  return { tenders: listTenders() };
}

export { DEFAULT_DAYWORK, DEFAULT_QUALIFICATIONS, alertForDeadline, daysLeftForDeadline };
