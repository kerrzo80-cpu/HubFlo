import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadServerStore, writeServerStore, getServerStoreDirectory } from "@/lib/server-store";
import {
  BOQ_SHEET_MARKER,
  type WorkbookSheetRows,
} from "@/lib/tenders-xlsx";
import { createJob } from "@/lib/workflow-data";
import { createTakeoffProject, getTakeoffProject, updateTakeoffProject } from "@/lib/takeoff-data";
import { deleteRecordDocumentByFileUrl, readRecordDocumentFile } from "@/lib/record-documents";
import {
  TENDER_DOCUMENT_FOLDER_MAX_DEPTH,
  isTenderDocumentKind,
  normalizeTenderDocumentFolders,
  resolveTenderDocumentFolderKind,
  tenderDocumentFolderDepth,
  type TenderDocumentFolder,
} from "@/lib/tender-document-folders";
import {
  TENDER_STATUSES,
  alertForDeadline,
  computeBoqTotal,
  daysLeftForDeadline,
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
} from "@/lib/tender-document-folders";
export type { TenderDocumentFolder } from "@/lib/tender-document-folders";

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

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
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
      tenderSum: 61810,
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

function readStore(): TenderStore {
  const stored = loadServerStore<Partial<TenderStore>>(STORE, { tenders: [] });
  const tenders = Array.isArray(stored.tenders) ? stored.tenders : [];
  if (!tenders.length) {
    const seeded = { tenders: seedTenders() };
    writeServerStore(STORE, seeded);
    return seeded;
  }
  return { tenders };
}

function writeStore(store: TenderStore) {
  writeServerStore(STORE, store);
  return store;
}

export function listTenders() {
  return readStore()
    .tenders.slice()
    .sort((a, b) => {
      const aDue = a.submissionDeadline || "9999-12-31";
      const bDue = b.submissionDeadline || "9999-12-31";
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      return a.name.localeCompare(b.name);
    });
}

export function getTender(id: string) {
  return readStore().tenders.find((tender) => tender.id === id) ?? null;
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
  const lines = Array.isArray(input.boqLines) ? input.boqLines : [];
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
    bidValue: Number.isFinite(input.bidValue) ? Number(input.bidValue) : boqTotal,
    tenderSum: Number.isFinite(input.tenderSum) ? Number(input.tenderSum) : boqTotal,
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
  const store = readStore();
  const next = normalizeTender(input);
  if (!next.name) throw new Error("Opportunity name is required.");
  if (!next.client) throw new Error("Client is required.");

  const existingIndex = store.tenders.findIndex((tender) => tender.id === next.id);
  if (existingIndex >= 0) {
    const previous = store.tenders[existingIndex]!;
    next.createdAt = previous.createdAt;
    store.tenders[existingIndex] = next;
  } else {
    store.tenders.unshift(next);
  }
  writeStore(store);
  return next;
}

export function updateTender(id: string, patch: Partial<Tender>) {
  const existing = getTender(id);
  if (!existing) throw new Error("Tender not found.");
  return upsertTender({ ...existing, ...patch, id });
}

export function deleteTender(id: string) {
  const store = readStore();
  const before = store.tenders.length;
  store.tenders = store.tenders.filter((tender) => tender.id !== id);
  if (store.tenders.length === before) throw new Error("Tender not found.");
  writeStore(store);
  return true;
}

export function markTenderSubmitted(id: string, options?: { tenderSum?: number; submittedAt?: string }) {
  const existing = getTender(id);
  if (!existing) throw new Error("Tender not found.");
  const boqTotal = computeBoqTotal(existing.boqLines);
  return updateTender(id, {
    status: "Sent",
    submittedAt: options?.submittedAt || nowIso(),
    tenderSum: options?.tenderSum ?? existing.tenderSum ?? boqTotal,
    bidValue: existing.bidValue || boqTotal,
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
  const rate = labels.findIndex((label) => headerMatches(label, ["unit rate", "rate", "price"]));
  const value = labels.findIndex((label) =>
    headerMatches(label, ["amount", "value", "extended", "total", "sum"]),
  );
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

    if (!description && !ref) continue;
    if (/^total$/i.test(ref) || /^total$/i.test(description.split("\n")[0] || "")) continue;

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

/** Parse each Excel worksheet as its own sheet tab (stamps `sheet` on every line). */
export function parseBoqFromWorkbookSheets(
  sheets: WorkbookSheetRows[],
  title?: string,
): { title: string; lines: TenderBoqLine[] } {
  const usable = (sheets || []).filter((sheet) =>
    sheet.rows?.some((row) => row.some((cell) => String(cell || "").trim())),
  );
  if (!usable.length) return { title: title || "", lines: [] };

  let resolvedTitle = title || "";
  const lines: TenderBoqLine[] = [];
  for (const sheet of usable) {
    const parsed = parseBoqFromRows(sheet.rows, resolvedTitle || undefined, { sheet: sheet.name });
    if (!resolvedTitle && parsed.title) resolvedTitle = parsed.title;
    for (const line of parsed.lines) {
      lines.push({
        ...line,
        sheet: sheet.name,
        section: line.kind === "header" ? line.section || line.description : line.section || sheet.name,
      });
    }
  }
  return { title: resolvedTitle, lines };
}

function applyBoqImport(id: string, parsed: { title: string; lines: TenderBoqLine[] }) {
  const existing = getTender(id);
  if (!existing) throw new Error("Tender not found.");
  const boqTotal = computeBoqTotal(parsed.lines);
  return updateTender(id, {
    boqTitle: parsed.title || existing.boqTitle,
    boqLines: parsed.lines,
    bidValue: boqTotal || existing.bidValue,
    tenderSum: existing.tenderSum && existing.tenderSum > 0 ? existing.tenderSum : boqTotal,
    status: existing.status === "Not Started" ? "In Progress" : existing.status,
  });
}

export function importBoqIntoTender(id: string, raw: string, title?: string) {
  return applyBoqImport(id, parseBoqDelimitedText(raw, title));
}

export function importBoqRowsIntoTender(id: string, rows: string[][], title?: string) {
  return applyBoqImport(id, parseBoqFromRows(rows, title));
}

export function importBoqWorkbookIntoTender(id: string, sheets: WorkbookSheetRows[], title?: string) {
  return applyBoqImport(id, parseBoqFromWorkbookSheets(sheets, title));
}

/** Wipe imported BoQ lines so the office can start a fresh import. Does not touch document uploads. */
export function clearBoqFromTender(id: string) {
  const existing = getTender(id);
  if (!existing) throw new Error("Tender not found.");
  return updateTender(id, {
    boqTitle: "",
    boqLines: [],
    bidValue: 0,
    tenderSum: existing.status === "Sent" || existing.status === "Won" ? existing.tenderSum : 0,
  });
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
  const boqLines = existing.boqLines.map((line) => {
    if (line.id !== lineId) return line;
    const next: TenderBoqLine = { ...line, ...patch };
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
    tenderSum: existing.tenderSum && existing.tenderSum > 0 ? existing.tenderSum : boqTotal,
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

export function convertTenderToPendingJob(tenderId: string) {
  const tender = getTender(tenderId);
  if (!tender) throw new Error("Tender not found.");
  if (tender.convertedJobId) {
    return { tender, job: null as ReturnType<typeof createJob> | null, alreadyConverted: true as const };
  }
  const value = Number.isFinite(tender.tenderSum) ? Number(tender.tenderSum) : computeBoqTotal(tender.boqLines) || tender.bidValue || 0;
  const job = createJob({
    clientId: tender.clientId,
    customer: tender.client,
    site: tender.area || "Site to be confirmed",
    description: `${tender.name}${tender.boqTitle ? ` — ${tender.boqTitle}` : ""}`.trim(),
    manager: tender.owner || "Unassigned",
    status: "Pending",
    value,
    next: "Won tender — schedule and start checks",
    due: tender.submissionDeadline || new Date().toISOString().slice(0, 10),
    sourceTenderId: tender.id,
    sourceTenderName: tender.name,
  });
  const updated = updateTender(tenderId, {
    status: "Won",
    convertedJobId: job.id,
    convertedJobRef: job.ref,
    tenderSum: value,
    bidValue: value || tender.bidValue,
  });
  return { tender: updated, job, alreadyConverted: false as const };
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

/** Copy tender drawing files into a takeoff project (skip ones already transferred). */
export function copyTenderDrawingsToTakeoff(tender: Tender, takeoffId: string) {
  const project = getTakeoffProject(takeoffId);
  if (!project) return { copied: 0, skipped: 0, takeoff: null as ReturnType<typeof getTakeoffProject> };

  const drawings = tender.documents.filter((doc) => doc.kind === "drawing");
  if (!drawings.length) return { copied: 0, skipped: 0, takeoff: project };

  const MAX_COPY_COUNT = 4;
  const MAX_COPY_BYTES = 25 * 1024 * 1024;

  const storageRoot = path.join(getServerStoreDirectory(), "takeoff-files", takeoffId);
  mkdirSync(storageRoot, { recursive: true });

  const added = [];
  let skipped = 0;
  for (const doc of drawings) {
    if (added.length >= MAX_COPY_COUNT) {
      skipped += 1;
      continue;
    }
    const sourceTag = `sourceTenderDoc:${doc.id}`;
    const alreadyThere = project.documents.some(
      (row) =>
        row.notes.includes(sourceTag)
        || (row.kind === "Drawing" && row.fileName === doc.name),
    );
    if (alreadyThere) continue;

    const recordId = recordDocumentIdFromUrl(doc.url);
    const file = recordId ? readRecordDocumentFile(recordId) : null;
    if (!file?.bytes?.length) {
      skipped += 1;
      continue;
    }
    if (file.bytes.length > MAX_COPY_BYTES) {
      skipped += 1;
      continue;
    }

    const documentId = `takeoff-doc-${randomUUID()}`;
    const storedFileName = `${documentId}-${safeTakeoffFileName(doc.name)}`;
    const storageKey = ["takeoff-files", takeoffId, storedFileName].join("/");
    writeFileSync(path.join(storageRoot, storedFileName), file.bytes);

    added.push({
      id: documentId,
      kind: "Drawing" as const,
      fileName: doc.name,
      mimeType: doc.mimeType || file.record.type || "application/pdf",
      size: file.bytes.length,
      storageKey,
      uploadedAt: nowIso(),
      status: "Uploaded" as const,
      notes: ["Copied from tender drawings on Send to Takeoff.", sourceTag],
    });
  }

  if (!added.length) return { copied: 0, skipped, takeoff: project };

  const documents = [...added, ...project.documents];
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

  return { copied: added.length, skipped, takeoff: takeoff ?? project };
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
