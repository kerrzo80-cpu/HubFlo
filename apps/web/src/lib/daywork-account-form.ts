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

export type DayworkLineItem = {
  description: string;
  qty: string;
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
  /** JSON array of { description, qty }. */
  materialsJson?: string;
  /** JSON array of { description, qty }. */
  plantJson?: string;
  /** Office-only fields (Core). */
  labourRate?: string;
  /** Office materials cost (£) for the sheet. */
  materialsCost?: string;
  /** Office plant cost (£) for the sheet. */
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
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const description = String(row.description || "").trim();
        const qty = String(row.qty ?? "").trim();
        if (!description && !qty) return null;
        return { description, qty };
      })
      .filter((item): item is DayworkLineItem => Boolean(item));
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
      .map((row) => ({ description: row.description.trim(), qty: String(row.qty).trim() }))
      .filter((row) => row.description || row.qty),
  );
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

/** Field captures hours/qty; Core office applies labour rate + materials/plant £. */
export function dayworkAccountTotals(record: DayworkAccountRecord | null | undefined) {
  const labourHours = totalDayworkLabourHours(record);
  const labourRate = parseMoney(record?.labourRate);
  const labourCost = labourHours * labourRate;
  const materials = parseMoney(record?.materialsCost);
  const plant = parseMoney(record?.plantCost);
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
    .filter((row) => row.day || row.hours)
    .map((row) => `${row.day || "Day"} ${row.hours || "0"}h`)
    .join(" · ");
}

function formatLineItems(value?: string) {
  const items = parseDayworkLineItems(value);
  if (!items.length) return "";
  return items
    .filter((item) => item.description || item.qty)
    .map((item) => `${item.description || "Item"}${item.qty ? ` × ${item.qty}` : ""}`)
    .join("; ");
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
        row("labourName", "Operative name", record?.labourName || context.engineer),
        row("labourTrade", "Trade", record?.labourTrade || ""),
        row("labourDays", "Hours by day", formatLabourDays(record)),
        row("labourHours", "Total hrs", totals.labourHours ? String(totals.labourHours) : ""),
        row("labourRate", "Rate £/hr (office)", record?.labourRate ? money(Number(record.labourRate)) : "Set in Core"),
      ],
    },
    {
      section: "Materials",
      rows: [
        row("materials", "Materials used", formatLineItems(record?.materialsJson)),
        row("materialsCost", "Materials cost (office)", record?.materialsCost ? money(parseMoney(record.materialsCost)) : "Set in Core"),
      ],
    },
    {
      section: "Plant",
      rows: [
        row("plant", "Plant used", formatLineItems(record?.plantJson)),
        row("plantCost", "Plant cost (office)", record?.plantCost ? money(parseMoney(record.plantCost)) : "Set in Core"),
      ],
    },
    {
      section: "Summary",
      rows: [
        row("sumLabourHrs", "Labour hours", totals.labourHours ? String(totals.labourHours) : ""),
        row("sumLabour", "Labour cost", money(totals.labourCost) || "Pending office rate"),
        row("sumMaterials", "Materials cost", money(totals.materialsWithMarkup) || "Pending office cost"),
        row("sumPlant", "Plant cost", money(totals.plantWithMarkup) || "Pending office cost"),
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

export function emptyDayworkSheetDraft(defaults?: Partial<DayworkSheetDraft>): DayworkSheetDraft {
  return {
    description: "",
    weekEnding: "",
    voReference: "",
    labourName: "",
    labourTrade: "Plumber",
    labourDays: [{ day: "Mon", hours: "" }],
    materials: [{ description: "", qty: "" }],
    plant: [{ description: "", qty: "" }],
    plumberSignature: "",
    clientSignature: "",
    plumberSignerName: "",
    clientSignerName: "",
    ...defaults,
  };
}

export function dayworkDraftFromRecord(
  record: DayworkAccountRecord | null | undefined,
  defaults?: Partial<DayworkSheetDraft>,
): DayworkSheetDraft {
  const labourDays = parseDayworkLabourDays(record?.labourDaysJson);
  const materials = parseDayworkLineItems(record?.materialsJson);
  const plant = parseDayworkLineItems(record?.plantJson);
  return emptyDayworkSheetDraft({
    description: record?.description || "",
    weekEnding: toUkDateDisplay(record?.weekEnding || ""),
    voReference: record?.voReference || "",
    labourName: record?.labourName || defaults?.labourName || "",
    labourTrade: record?.labourTrade || defaults?.labourTrade || "Plumber",
    labourDays: labourDays.length ? labourDays : [{ day: "Mon", hours: record?.labourHours || "" }],
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
