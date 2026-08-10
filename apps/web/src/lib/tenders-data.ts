import { loadServerStore, writeServerStore } from "@/lib/server-store";
import {
  TENDER_STATUSES,
  alertForDeadline,
  computeBoqTotal,
  daysLeftForDeadline,
  type Tender,
  type TenderBoqLine,
  type TenderDayworkRates,
  type TenderStatus,
} from "@/lib/tenders-types";

export * from "@/lib/tenders-types";

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
          excluded: true,
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

function normalizeTender(input: Partial<Tender> & { name: string; client: string }): Tender {
  const now = nowIso();
  const lines = Array.isArray(input.boqLines) ? input.boqLines : [];
  const boqTotal = computeBoqTotal(lines);
  return {
    id: input.id || uid("tender"),
    externalId: input.externalId?.trim() || undefined,
    name: input.name.trim(),
    client: input.client.trim(),
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
    documents: Array.isArray(input.documents) ? input.documents : [],
    submittedAt: input.submittedAt,
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

/** Parse CSV/TSV BoQ text with columns Ref, Description, Quantity, Units, Rate, Value [, Note]. */
export function parseBoqDelimitedText(raw: string, title?: string): { title: string; lines: TenderBoqLine[] } {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return { title: title || "", lines: [] };
  const linesRaw = text.split(/\r?\n/).filter((line) => line.trim().length);
  const delimiter = linesRaw[0]?.includes("\t") ? "\t" : ",";

  const splitRow = (row: string) => {
    if (delimiter === "\t") return row.split("\t").map((cell) => cell.trim());
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i += 1) {
      const ch = row[i]!;
      if (ch === '"') {
        if (inQuotes && row[i + 1] === '"') {
          current += '"';
          i += 1;
        } else inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  };

  let start = 0;
  let resolvedTitle = title || "";
  const first = splitRow(linesRaw[0] || "");
  if (first.length === 1 || (first[0] && !/^ref$/i.test(first[0]) && !first[1])) {
    resolvedTitle = first[0] || resolvedTitle;
    start = 1;
  }
  const header = splitRow(linesRaw[start] || "");
  if (header[0] && /^ref$/i.test(header[0])) start += 1;

  const lines: TenderBoqLine[] = [];
  for (let i = start; i < linesRaw.length; i += 1) {
    const cols = splitRow(linesRaw[i] || "");
    const ref = cols[0] || "";
    const description = cols[1] || cols[0] || "";
    if (!description && !ref) continue;
    if (/^total$/i.test(ref) || /^total$/i.test(description)) continue;

    const quantity = parseNumber(cols[2]);
    const unit = cols[3] || "";
    const rate = parseNumber(cols[4]);
    const value = parseNumber(cols[5]);
    const note = cols[6] || "";

    if (!ref && quantity === null && rate === null && value === null) {
      lines.push({
        id: uid("boq"),
        kind: "header",
        description: description || ref,
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
      excluded: rate === null && value === null,
    });
  }

  return { title: resolvedTitle, lines };
}

export function importBoqIntoTender(id: string, raw: string, title?: string) {
  const parsed = parseBoqDelimitedText(raw, title);
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

export function updateBoqLine(tenderId: string, lineId: string, patch: Partial<TenderBoqLine>) {
  const existing = getTender(tenderId);
  if (!existing) throw new Error("Tender not found.");
  const boqLines = existing.boqLines.map((line) => {
    if (line.id !== lineId) return line;
    const next = { ...line, ...patch };
    if (next.kind === "measured" && !next.excluded) {
      if (
        (patch.rate !== undefined || patch.quantity !== undefined) &&
        typeof next.rate === "number" &&
        typeof next.quantity === "number"
      ) {
        next.value = roundMoney(next.rate * next.quantity);
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

export { DEFAULT_DAYWORK, DEFAULT_QUALIFICATIONS, alertForDeadline, daysLeftForDeadline };
