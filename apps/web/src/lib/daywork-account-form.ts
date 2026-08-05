import { toUkDateDisplay } from "@/lib/uk-date";

export const DAYWORK_TRADE_OPTIONS = ["Plumber", "Joiner", "Apprentice"] as const;
export type DayworkTrade = (typeof DAYWORK_TRADE_OPTIONS)[number];

export const DAYWORK_WEEKDAY_OPTIONS = [
  { id: "Mon", label: "Monday" },
  { id: "Tue", label: "Tuesday" },
  { id: "Wed", label: "Wednesday" },
  { id: "Thu", label: "Thursday" },
  { id: "Fri", label: "Friday" },
  { id: "Sat", label: "Saturday" },
  { id: "Sun", label: "Sunday" },
] as const;

export type DayworkLabourDay = {
  day: string;
  hours: string;
};

/** Field captures description + qty; Core office fills unitCost (£ each). */
export type DayworkLineItem = {
  description: string;
  qty: string;
  unitCost?: string;
};

/** Client-safe Daywork Account record (Field + Core form). Rates / costs filled in Core by office. */
export type DayworkAccountRecord = {
  description?: string;
  weekEnding?: string;
  voReference?: string;
  labourName?: string;
  labourTrade?: string;
  /** JSON array of { day, hours } — e.g. Mon 8 + Tue 4. */
  labourDaysJson?: string;
  /** Derived total hours across labour days (for variations). */
  labourHours?: string;
  /** JSON array of { description, qty, unitCost? }. */
  materialsJson?: string;
  /** JSON array of { description, qty, unitCost? }. */
  plantJson?: string;
  /** Office-only fields (Core). */
  labourRate?: string;
  /** Derived materials total (£) from line unit costs — kept for older readers. */
  materialsCost?: string;
  /** Derived plant total (£) from line unit costs — kept for older readers. */
  plantCost?: string;
  markupPercent?: string;
  plumberSignature?: string;
  clientSignature?: string;
  /** Printed names next to drawn signatures (required — signatures may be illegible). */
  plumberSignerName?: string;
  clientSignerName?: string;
  completedAt?: string;
  populatedFrom: "engineer-app" | "core";
};

export type DayworkSheetSnapshot = DayworkAccountRecord & {
  jobId: string;
  jobRef: string;
  costCentreId: string;
  updatedAt: string;
};

export function dayworkSheetKey(jobId: string, costCentreId: string) {
  return `${jobId}:${costCentreId}`;
}

/** Dual signatures = submitted to Core; Field must treat as locked read-only. */
export function isDayworkSubmittedToCore(record?: DayworkAccountRecord | null): boolean {
  if (!record) return false;
  if ((record as DayworkAccountRecord & { hasSignatures?: boolean }).hasSignatures === true) return true;
  return Boolean(
    String(record.plumberSignature || "").trim() && String(record.clientSignature || "").trim(),
  );
}

/** Field stop/go rows that belong to a Daywork sheet (not the job gas/plumbing checklist). */
export function isDayworkRequirement(item: {
  id?: string;
  stage?: string;
  stepId?: string;
  costCentreId?: string;
}): boolean {
  if (item.stage === "Daywork") return true;
  if (item.stepId?.startsWith("daywork-")) return true;
  if (item.costCentreId && /daywork/i.test(item.costCentreId)) return true;
  const id = String(item.id || "");
  if (id.startsWith("daywork-")) return true;
  if (id.includes("-daywork-account") || id.includes(":daywork-")) return true;
  return false;
}

/**
 * Poll/list payload without base64 signature images (keeps bandwidth down).
 * Full signatures stay on disk and are only loaded for PDF / valuation export.
 */
export function summarizeDayworkSheetForPoll<T extends DayworkAccountRecord>(
  sheet: T,
): T & { hasSignatures: boolean } {
  const hasSignatures = isDayworkSubmittedToCore(sheet);
  const {
    plumberSignature: _plumberSignature,
    clientSignature: _clientSignature,
    ...rest
  } = sheet as T & { plumberSignature?: string; clientSignature?: string };
  return {
    ...(rest as T),
    plumberSignature: "",
    clientSignature: "",
    hasSignatures,
  };
}

export function summarizeDayworkSheetsMapForPoll(
  sheets: Record<string, DayworkAccountRecord> | null | undefined,
): Record<string, DayworkAccountRecord & { hasSignatures: boolean }> {
  const out: Record<string, DayworkAccountRecord & { hasSignatures: boolean }> = {};
  for (const [key, sheet] of Object.entries(sheets || {})) {
    if (!sheet || typeof sheet !== "object") continue;
    out[key] = summarizeDayworkSheetForPoll(sheet);
  }
  return out;
}

/** Stable ordinal from cost-centre id (`…-daywork-account` → 1, `…-daywork-account-2` → 2). */
export function dayworkSheetNumber(jobId: string, costCentreId: string): number {
  const prefix = `${jobId}-daywork-account`;
  const trimmed = String(costCentreId || "").trim();
  if (!trimmed) return Number.MAX_SAFE_INTEGER;
  if (trimmed === prefix) return 1;
  if (trimmed.startsWith(`${prefix}-`)) {
    const suffix = trimmed.slice(prefix.length + 1);
    const n = Number(suffix);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function dayworkSheetListLabel(jobId: string, costCentreId: string): string {
  const n = dayworkSheetNumber(jobId, costCentreId);
  return n < Number.MAX_SAFE_INTEGER ? `Daywork ${n}` : "Daywork";
}

export function sortDayworkSheetsByNumber<T extends { costCentreId: string; updatedAt?: string; completedAt?: string }>(
  jobId: string,
  sheets: T[],
): T[] {
  return [...sheets].sort((left, right) => {
    const leftN = dayworkSheetNumber(jobId, left.costCentreId);
    const rightN = dayworkSheetNumber(jobId, right.costCentreId);
    if (leftN !== rightN) return leftN - rightN;
    const leftAt = String(left.completedAt || left.updatedAt || "");
    const rightAt = String(right.completedAt || right.updatedAt || "");
    return leftAt.localeCompare(rightAt);
  });
}

/** Drop office pricing so Field never displays Daywork £ values. */
export function stripDayworkOfficePricing<T extends DayworkAccountRecord>(record: T): T {
  const {
    labourRate: _labourRate,
    materialsCost: _materialsCost,
    plantCost: _plantCost,
    markupPercent: _markupPercent,
    ...rest
  } = record;
  void _labourRate;
  void _materialsCost;
  void _plantCost;
  void _markupPercent;
  return rest as T;
}

export function parseDayworkLabourDays(value?: string): DayworkLabourDay[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const day = String(row.day || "").trim();
        const hours = String(row.hours ?? "").trim();
        if (!day && !hours) return null;
        return { day, hours };
      })
      .filter((item): item is DayworkLabourDay => Boolean(item));
  } catch {
    return [];
  }
}

export function parseDayworkLineItems(value?: string): DayworkLineItem[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows: DayworkLineItem[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const description = String(row.description || "").trim();
      const qty = String(row.qty ?? "").trim();
      const unitCost = String(row.unitCost ?? "").trim();
      if (!description && !qty && !unitCost) continue;
      rows.push({
        description,
        qty,
        ...(unitCost ? { unitCost } : {}),
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export function serialiseDayworkLabourDays(rows: DayworkLabourDay[]) {
  return JSON.stringify(
    rows
      .map((row) => ({ day: row.day.trim(), hours: String(row.hours).trim() }))
      .filter((row) => row.day || row.hours),
  );
}

export function serialiseDayworkLineItems(rows: DayworkLineItem[]) {
  return JSON.stringify(
    rows
      .map((row) => ({
        description: row.description.trim(),
        qty: String(row.qty).trim(),
        ...(String(row.unitCost || "").trim() ? { unitCost: String(row.unitCost).trim() } : {}),
      }))
      .filter((row) => row.description || row.qty),
  );
}

/** Merge Field qty/description lines with any office unit costs already on the sheet. */
export function mergeDayworkLineUnitCosts(fieldJson?: string, pricedJson?: string) {
  const fieldLines = parseDayworkLineItems(fieldJson);
  const pricedLines = parseDayworkLineItems(pricedJson);
  if (!fieldLines.length) return pricedJson || fieldJson || "";
  const next = fieldLines.map((line, index) => {
    const match =
      pricedLines.find(
        (priced) =>
          priced.description.trim().toLowerCase() === line.description.trim().toLowerCase() &&
          String(priced.qty).trim() === String(line.qty).trim(),
      ) || pricedLines[index];
    return {
      ...line,
      unitCost: line.unitCost || match?.unitCost || "",
    };
  });
  return serialiseDayworkLineItems(next);
}

export function totalDayworkLabourHours(record: DayworkAccountRecord | null | undefined) {
  const days = parseDayworkLabourDays(record?.labourDaysJson);
  if (days.length) {
    return days.reduce((sum, row) => {
      const n = Number(String(row.hours || "").replace(/[^0-9.]/g, ""));
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }
  const legacy = Number(String(record?.labourHours || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(legacy) ? legacy : 0;
}

function parseMoney(value?: string) {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function dayworkLineAmount(item: DayworkLineItem) {
  const qty = parseMoney(item.qty);
  const unitCost = parseMoney(item.unitCost);
  return qty * unitCost;
}

export function sumDayworkLineItems(value?: string) {
  return parseDayworkLineItems(value).reduce((sum, item) => sum + dayworkLineAmount(item), 0);
}

/** Field captures hours/qty; Core office applies labour rate + per-line materials/plant £. */
export function dayworkAccountTotals(record: DayworkAccountRecord | null | undefined) {
  const labourHours = totalDayworkLabourHours(record);
  const labourRate = parseMoney(record?.labourRate);
  const labourCost = labourHours * labourRate;
  const materialsFromLines = sumDayworkLineItems(record?.materialsJson);
  const plantFromLines = sumDayworkLineItems(record?.plantJson);
  const materials = materialsFromLines > 0 ? materialsFromLines : parseMoney(record?.materialsCost);
  const plant = plantFromLines > 0 ? plantFromLines : parseMoney(record?.plantCost);
  const markupPercent = parseMoney(record?.markupPercent);
  const materialsWithMarkup = materials * (1 + markupPercent / 100);
  const plantWithMarkup = plant * (1 + markupPercent / 100);
  const total = labourCost + materialsWithMarkup + plantWithMarkup;
  return {
    labourHours,
    labourCost,
    expenses: 0,
    materials,
    plant,
    markupPercent,
    materialsWithMarkup,
    plantWithMarkup,
    expensesWithMarkup: 0,
    total,
  };
}

function money(value: number) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

function formatLabourDays(record: DayworkAccountRecord | null | undefined) {
  const days = parseDayworkLabourDays(record?.labourDaysJson);
  if (!days.length) return record?.labourHours ? `${record.labourHours} hrs` : "";
  return days
    .filter((row) => Number(String(row.hours || "").replace(/[^0-9.]/g, "")) > 0)
    .map((row) => `${row.day || "Day"} ${row.hours || "0"}h`)
    .join(" · ");
}

function formatLineItems(value?: string, options?: { includePrices?: boolean }) {
  const items = parseDayworkLineItems(value);
  if (!items.length) return "";
  const includePrices = Boolean(options?.includePrices);
  return items
    .filter((item) => item.description || item.qty)
    .map((item) => {
      const qtyBit = item.qty ? ` × ${item.qty}` : "";
      if (!includePrices) return `${item.description || "Item"}${qtyBit}`;
      const amount = dayworkLineAmount(item);
      const unit = parseMoney(item.unitCost);
      const priced =
        unit > 0
          ? ` @ ${money(unit)}${amount ? ` = ${money(amount)}` : ""}`
          : "";
      return `${item.description || "Item"}${qtyBit}${priced}`;
    })
    .join("; ");
}

/** Human summary for Field checklist — never dump raw JSON or £ values. */
export function formatFieldDayworkEvidenceSummary(label: string, raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const lower = label.toLowerCase();
  if (text.startsWith("[") || text.startsWith("{")) {
    if (lower.includes("labour") || lower.includes("hours")) {
      const days = parseDayworkLabourDays(text);
      if (days.length) {
        const worked = days.filter((row) => Number(String(row.hours || "").replace(/[^0-9.]/g, "")) > 0);
        if (!worked.length) return "No hours entered";
        return worked.map((row) => `${row.day || "Day"} ${row.hours}h`).join(" · ");
      }
    }
    if (lower.includes("material") || lower.includes("plant")) {
      const summary = formatLineItems(text, { includePrices: false });
      if (summary) return summary;
    }
  }
  return text;
}

export type DayworkAccountContext = {
  customer: string;
  site: string;
  engineer: string;
  jobRef: string;
  contract?: string;
  record: DayworkAccountRecord | null;
};

export type DayworkFormSection = {
  section: string;
  rows: Array<{ key: string; label: string; value: string; filled: boolean }>;
};

export function buildDayworkFormSections(context: DayworkAccountContext): DayworkFormSection[] {
  const record = context.record;
  const totals = dayworkAccountTotals(record);
  const row = (key: string, label: string, value: string) => ({
    key,
    label,
    value: value.trim() || "—",
    filled: Boolean(value.trim()),
  });

  return [
    {
      section: "Header",
      rows: [
        row("to", "To (client)", context.customer),
        row("contract", "Contract / site", context.contract || context.site),
        row("jobNo", "Job No.", context.jobRef),
        row("weekEnding", "Week ending", toUkDateDisplay(record?.weekEnding || "")),
        row("vo", "Variation reference", record?.voReference || ""),
        row("sheet", "Sheet No.", "1"),
      ],
    },
    {
      section: "Description",
      rows: [row("description", "Description of works", record?.description || "")],
    },
    {
      section: "Labour",
      rows: [
        row("labourName", "Operative name", record?.labourName || ""),
        row("labourTrade", "Trade", record?.labourTrade || ""),
        row("labourDays", "Hours by day", formatLabourDays(record)),
        row("labourHours", "Total hrs", totals.labourHours ? String(totals.labourHours) : ""),
        row("labourRate", "Rate £/hr (office)", record?.labourRate ? money(Number(record.labourRate)) : "Set in Core"),
      ],
    },
    {
      section: "Materials",
      rows: [
        row("materials", "Materials used", formatLineItems(record?.materialsJson, { includePrices: true })),
        row("materialsCost", "Materials total", money(totals.materials) || "Set unit prices in Core"),
      ],
    },
    {
      section: "Plant",
      rows: [
        row("plant", "Plant used", formatLineItems(record?.plantJson, { includePrices: true })),
        row("plantCost", "Plant total", money(totals.plant) || "Set unit prices in Core"),
      ],
    },
    {
      section: "Summary",
      rows: [
        row("sumLabourHrs", "Labour hours", totals.labourHours ? String(totals.labourHours) : ""),
        row("sumLabour", "Labour cost", money(totals.labourCost) || "Pending office rate"),
        row("sumMaterials", "Materials cost", money(totals.materialsWithMarkup) || "Pending office prices"),
        row("sumPlant", "Plant cost", money(totals.plantWithMarkup) || "Pending office prices"),
        row("markup", "Add % (office)", totals.markupPercent ? `${totals.markupPercent}%` : "Set in Core"),
        row("sumTotal", "Sheet total", money(totals.total) || "Pending office pricing"),
      ],
    },
    {
      section: "Sign-off",
      rows: [
        row("plumberName", "Plumber / contractor name", record?.plumberSignerName || ""),
        row("plumber", "Plumber / contractor signature", record?.plumberSignature || ""),
        row("clientName", "Client / Clerk of Works name", record?.clientSignerName || ""),
        row("client", "Client / Clerk of Works signature", record?.clientSignature || ""),
      ],
    },
  ];
}

/** Field draft shape used by the Daywork sheet editor. */
export type DayworkSheetDraft = {
  description: string;
  weekEnding: string;
  voReference: string;
  labourName: string;
  labourTrade: string;
  labourDays: DayworkLabourDay[];
  materials: DayworkLineItem[];
  plant: DayworkLineItem[];
  plumberSignature: string;
  clientSignature: string;
  plumberSignerName: string;
  clientSignerName: string;
};

export function normalizeWeekLabourDays(days: DayworkLabourDay[] | undefined | null): DayworkLabourDay[] {
  const byDay = new Map(
    (days || [])
      .filter((row) => row.day.trim())
      .map((row) => [row.day.trim(), String(row.hours ?? "").trim()] as const),
  );
  return DAYWORK_WEEKDAY_OPTIONS.map((day) => ({
    day: day.id,
    hours: byDay.get(day.id) || "",
  }));
}

/** Upcoming Sunday as DD-MM-YYYY so Field Save is not blocked by an empty week-ending. */
export function defaultDayworkWeekEndingUk(from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = date.getDay(); // 0 = Sun
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  date.setDate(date.getDate() + daysUntilSunday);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy}`;
}

export function emptyDayworkSheetDraft(defaults?: Partial<DayworkSheetDraft>): DayworkSheetDraft {
  const { labourDays: incomingDays, ...rest } = defaults || {};
  return {
    description: "",
    weekEnding: defaultDayworkWeekEndingUk(),
    voReference: "",
    labourName: "",
    labourTrade: "Plumber",
    materials: [{ description: "", qty: "" }],
    plant: [{ description: "", qty: "" }],
    plumberSignature: "",
    clientSignature: "",
    plumberSignerName: "",
    clientSignerName: "",
    ...rest,
    labourDays: normalizeWeekLabourDays(incomingDays),
  };
}

export function dayworkDraftFromRecord(
  record: DayworkAccountRecord | null | undefined,
  defaults?: Partial<DayworkSheetDraft>,
): DayworkSheetDraft {
  const labourDays = parseDayworkLabourDays(record?.labourDaysJson);
  const materials = parseDayworkLineItems(record?.materialsJson);
  const plant = parseDayworkLineItems(record?.plantJson);
  const weekDays =
    labourDays.length > 0
      ? normalizeWeekLabourDays(labourDays)
      : normalizeWeekLabourDays(
          record?.labourHours ? [{ day: "Mon", hours: record.labourHours }] : [],
        );
  return emptyDayworkSheetDraft({
    description: record?.description || "",
    weekEnding: toUkDateDisplay(record?.weekEnding || ""),
    voReference: record?.voReference || "",
    labourName: record?.labourName || defaults?.labourName || "",
    labourTrade: record?.labourTrade || defaults?.labourTrade || "Plumber",
    labourDays: weekDays,
    materials: materials.length ? materials : [{ description: "", qty: "" }],
    plant: plant.length ? plant : [{ description: "", qty: "" }],
    plumberSignature: record?.plumberSignature || "",
    clientSignature: record?.clientSignature || "",
    plumberSignerName: record?.plumberSignerName || defaults?.plumberSignerName || record?.labourName || "",
    clientSignerName: record?.clientSignerName || defaults?.clientSignerName || "",
  });
}

export function dayworkRecordFromDraft(
  draft: DayworkSheetDraft,
  populatedFrom: DayworkAccountRecord["populatedFrom"] = "engineer-app",
): DayworkAccountRecord {
  const labourDaysJson = serialiseDayworkLabourDays(draft.labourDays);
  const materialsJson = serialiseDayworkLineItems(draft.materials);
  const plantJson = serialiseDayworkLineItems(draft.plant);
  const labourHours = String(
    totalDayworkLabourHours({
      labourDaysJson,
      labourHours: "",
      populatedFrom,
    }),
  );
  return {
    description: draft.description.trim(),
    weekEnding: draft.weekEnding.trim(),
    voReference: draft.voReference.trim(),
    labourName: draft.labourName.trim(),
    labourTrade: draft.labourTrade.trim(),
    labourDaysJson,
    labourHours,
    materialsJson,
    plantJson,
    plumberSignature: draft.plumberSignature.trim(),
    clientSignature: draft.clientSignature.trim(),
    plumberSignerName: draft.plumberSignerName.trim(),
    clientSignerName: draft.clientSignerName.trim(),
    completedAt: new Date().toISOString(),
    populatedFrom,
  };
}

export function validateDayworkSheetDraft(draft: DayworkSheetDraft): string | null {
  if (draft.description.trim().length < 4) return "Enter a description of works.";
  if (!draft.weekEnding.trim()) return "Pick the week ending date.";
  if (draft.labourName.trim().length < 2) return "Enter the operative name.";
  if (!DAYWORK_TRADE_OPTIONS.includes(draft.labourTrade as DayworkTrade)) {
    return "Choose a labour trade.";
  }
  const days = draft.labourDays.filter((row) => row.day.trim() && String(row.hours).trim());
  if (!days.length) return "Add at least one day with hours.";
  for (const row of days) {
    const hours = Number(String(row.hours).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(hours) || hours <= 0) return `Enter hours for ${row.day}.`;
  }
  if (draft.plumberSignerName.trim().length < 2) {
    return "Enter the plumber / contractor printed name (signatures can be hard to read).";
  }
  if (draft.clientSignerName.trim().length < 2) {
    return "Enter the client / Clerk of Works printed name.";
  }
  if (!draft.plumberSignature.trim() || (draft.plumberSignature.trim().length < 2 && !draft.plumberSignature.startsWith("data:image/"))) {
    return "Plumber signature is required — draw it on the pad.";
  }
  if (!draft.clientSignature.trim() || (draft.clientSignature.trim().length < 2 && !draft.clientSignature.startsWith("data:image/"))) {
    return "Client signature is required — draw it on the pad.";
  }
  return null;
}

export function summariseDayworkMaterials(record: DayworkAccountRecord | null | undefined) {
  return formatLineItems(record?.materialsJson);
}

export function summariseDayworkPlant(record: DayworkAccountRecord | null | undefined) {
  return formatLineItems(record?.plantJson);
}

/** Apply derived materials/plant totals from per-line unit costs onto the record. */
export function withDerivedDayworkLineTotals(record: DayworkAccountRecord): DayworkAccountRecord {
  const totals = dayworkAccountTotals(record);
  return {
    ...record,
    materialsCost: totals.materials ? String(Math.round(totals.materials * 100) / 100) : record.materialsCost,
    plantCost: totals.plant ? String(Math.round(totals.plant * 100) / 100) : record.plantCost,
  };
}
