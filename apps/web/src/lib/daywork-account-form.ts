import { toUkDateDisplay } from "@/lib/uk-date";

/** Client-safe Daywork Account record + totals (no Node / SQLite imports). */
export type DayworkAccountRecord = {
  description?: string;
  weekEnding?: string;
  voReference?: string;
  labourName?: string;
  labourTrade?: string;
  labourHours?: string;
  labourRate?: string;
  labourExpenses?: string;
  material1Description?: string;
  material1Qty?: string;
  material1UnitPrice?: string;
  material2Description?: string;
  material2Qty?: string;
  material2UnitPrice?: string;
  plantDescription?: string;
  plantHours?: string;
  plantRate?: string;
  markupPercent?: string;
  worksPhoto?: string;
  plumberSignature?: string;
  clientSignature?: string;
  completedAt?: string;
  populatedFrom: "engineer-app" | "core";
};

function parseMoney(value?: string) {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function dayworkAccountTotals(record: DayworkAccountRecord | null | undefined) {
  const labourHours = parseMoney(record?.labourHours);
  const labourRate = parseMoney(record?.labourRate);
  const labourCost = labourHours * labourRate;
  const expenses = parseMoney(record?.labourExpenses);
  const material1 = parseMoney(record?.material1Qty) * parseMoney(record?.material1UnitPrice);
  const material2 = parseMoney(record?.material2Qty) * parseMoney(record?.material2UnitPrice);
  const materials = material1 + material2;
  const plant = parseMoney(record?.plantHours) * parseMoney(record?.plantRate);
  const markupPercent = parseMoney(record?.markupPercent);
  const materialsWithMarkup = materials * (1 + markupPercent / 100);
  const plantWithMarkup = plant * (1 + markupPercent / 100);
  const expensesWithMarkup = expenses * (1 + markupPercent / 100);
  const total = labourCost + expensesWithMarkup + materialsWithMarkup + plantWithMarkup;
  return {
    labourHours,
    labourCost,
    expenses,
    materials,
    plant,
    markupPercent,
    materialsWithMarkup,
    plantWithMarkup,
    expensesWithMarkup,
    total,
  };
}

function money(value: number) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
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
        row("vo", "V.O.", record?.voReference || ""),
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
        row("labourName", "Name", record?.labourName || context.engineer),
        row("labourTrade", "Trade", record?.labourTrade || ""),
        row("labourRate", "Rate", record?.labourRate ? money(Number(record.labourRate)) : ""),
        row("labourHours", "Total hrs", record?.labourHours || ""),
        row("labourCost", "Labour cost", money(totals.labourCost)),
        row("expenses", "Expenses", money(totals.expenses)),
      ],
    },
    {
      section: "Materials",
      rows: [
        row(
          "material1",
          "Material 1",
          record?.material1Description
            ? `${record.material1Description} · qty ${record.material1Qty || "—"} · ${money(Number(record.material1UnitPrice || 0))}`
            : "",
        ),
        row(
          "material2",
          "Material 2",
          record?.material2Description
            ? `${record.material2Description} · qty ${record.material2Qty || "—"} · ${money(Number(record.material2UnitPrice || 0))}`
            : "",
        ),
        row("materialsTotal", "Materials total", money(totals.materials)),
      ],
    },
    {
      section: "Plant",
      rows: [
        row("plant", "Plant", record?.plantDescription || ""),
        row("plantHours", "Plant hrs", record?.plantHours || ""),
        row("plantRate", "Plant rate", record?.plantRate ? money(Number(record.plantRate)) : ""),
        row("plantCost", "Plant cost", money(totals.plant)),
      ],
    },
    {
      section: "Summary",
      rows: [
        row("sumLabour", "Labour", money(totals.labourCost)),
        row("sumExpenses", "Expenses (+ add %)", money(totals.expensesWithMarkup)),
        row("sumMaterials", "Material (+ add %)", money(totals.materialsWithMarkup)),
        row("sumPlant", "Plant (+ add %)", money(totals.plantWithMarkup)),
        row("markup", "Add %", totals.markupPercent ? `${totals.markupPercent}%` : ""),
        row("grand", "Total £", money(totals.total)),
      ],
    },
    {
      section: "Sign-off",
      rows: [
        row("plumber", "Signature of contractor (plumber)", record?.plumberSignature || ""),
        row("client", "Signature of Clerk of Works / client", record?.clientSignature || ""),
        row("photo", "Works photo", record?.worksPhoto || ""),
      ],
    },
  ];
}
