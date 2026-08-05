/**
 * Map Simpro sections → cost centres → materials/labour into NeXa hub shapes.
 * Pure functions — no I/O. Used by deep import on Apply sync.
 */

import type { UnknownRecord } from "@/lib/simpro-client";
import { asRecord, simproRecordId } from "@/lib/simpro-client";

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function firstString(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    if (key.includes(".")) {
      const [head, ...rest] = key.split(".");
      const nested = record[head ?? ""];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const value = firstString(nested as UnknownRecord, [rest.join(".")]);
        if (value) return value;
      }
      continue;
    }
    const value = asString(record[key]);
    if (value) return value;
  }
  return "";
}

function money(record: UnknownRecord | null | undefined, keys: string[], fallback = 0): number {
  if (!record) return fallback;
  for (const key of keys) {
    if (key.includes(".")) {
      const [head, ...rest] = key.split(".");
      const nested = asRecord(record[head ?? ""]);
      if (nested) {
        const value: number = money(nested, [rest.join(".")], Number.NaN);
        if (Number.isFinite(value)) return value;
      }
      continue;
    }
    const value = asNumber(record[key], Number.NaN);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function markupPercent(unitCost: number, unitSell: number) {
  if (!(unitCost > 0) || !(unitSell > 0)) return 30;
  return Math.round(((unitSell - unitCost) / unitCost) * 1000) / 10;
}

export type MappedQuoteCostLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitSell: number;
  supplierRequired?: boolean;
};

export type MappedQuoteCostCentre = {
  id: string;
  name: string;
  sectionId?: string;
  sectionName?: string;
  templateName?: string;
  clientDescription?: string;
  engineerDescription?: string;
  lines: MappedQuoteCostLine[];
  simproSectionId?: string;
  simproCostCentreId?: string;
};

export type MappedEstimateMaterialLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
  supplierRequired?: boolean;
  rateSource?: "ratebook" | "manual";
};

export type MappedEstimateLabourLine = {
  id: string;
  catalogItemId?: string;
  role: string;
  hours: number;
  costRate: number;
  markupPercent: number;
  rateSource?: "ratebook" | "manual";
};

export type MappedJobCostCentre = {
  id: string;
  name: string;
  sectionId?: string;
  templateName?: string;
  clientDescription: string;
  engineerDescription: string;
  materials: MappedEstimateMaterialLine[];
  labour: MappedEstimateLabourLine[];
  simproSectionId?: string;
  simproCostCentreId?: string;
};

export type MappedJobScheduleAssignment = {
  id: string;
  jobId: string;
  costCentreId: string;
  costCentreName: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  plannedHours: number;
  notes: string;
  simproScheduleId?: string;
};

export type MappedInvoiceLine = {
  id: string;
  description: string;
  category: "Materials" | "Labour" | "Variations" | "Other";
  costToUs: number;
  chargeToClient: number;
  note?: string;
};

export type MappedInvoice = {
  externalId: string;
  externalNumber?: string;
  status: "Draft" | "Sent" | "Partially paid" | "Paid" | "Cancelled";
  customer: string;
  issuedDate: string;
  dueDate: string;
  title: string;
  lines: MappedInvoiceLine[];
  costTotal: number;
  chargeTotal: number;
  notes: string;
  simproJobId?: string;
  simproQuoteId?: string;
  sourceModifiedAt?: string;
};

export type HierarchyStats = {
  sections: number;
  costCentres: number;
  materialLines: number;
  labourLines: number;
};

function itemCollections(costCenter: UnknownRecord): UnknownRecord[] {
  const items = asRecord(costCenter.Items) ?? costCenter;
  const bags: unknown[] = [
    items.Labors,
    items.Labours,
    items.Labor,
    items.Labour,
    items.Catalogs,
    items.Catalogues,
    items.Materials,
    items.OneOffs,
    items.Oneoffs,
    items.Prebuilds,
    items.ServiceFees,
    items.Items,
  ];
  const out: UnknownRecord[] = [];
  for (const bag of bags) {
    if (!Array.isArray(bag)) continue;
    for (const row of bag) {
      const record = asRecord(row);
      if (record) out.push(record);
    }
  }
  return out;
}

function isLabourItem(record: UnknownRecord) {
  const type = firstString(record, ["Type", "ItemType", "LaborType.Name", "LabourType.Name"]).toLowerCase();
  if (type.includes("labor") || type.includes("labour")) return true;
  if (record.LaborType || record.LabourType || record.LaborRate || record.LabourRate) return true;
  const description = firstString(record, ["Name", "Description", "LaborType.Name", "Catalogue.Name", "Catalog.Name"]);
  return /\b(labour|labor|engineer hours?|plumber hours?|fitter hours?)\b/i.test(description);
}

function lineDescription(record: UnknownRecord, labour: boolean) {
  return (
    stripHtml(
      firstString(record, [
        "Name",
        "Description",
        "Catalogue.Name",
        "Catalog.Name",
        "LaborType.Name",
        "LabourType.Name",
        "PartNo",
        "SKU",
      ]),
    ) || (labour ? "Labour" : "Material")
  );
}

function lineQuantity(record: UnknownRecord) {
  return (
    money(record, ["Total.Qty", "Qty", "Quantity", "Hours", "Total.Hours"], Number.NaN) ||
    asNumber(asRecord(record.Total)?.Qty, 1) ||
    1
  );
}

function lineUnitSell(record: UnknownRecord, qty: number) {
  const direct = money(record, [
    "SellPrice.ExTax",
    "SellPrice",
    "UnitPrice.ExTax",
    "UnitPrice",
    "Price.ExTax",
    "Price",
  ], Number.NaN);
  if (Number.isFinite(direct)) return direct;
  const total = money(record, ["Total.Amount.ExTax", "Total.ExTax", "Total.Amount", "Amount.ExTax", "Amount"], Number.NaN);
  if (Number.isFinite(total) && qty > 0) return Math.round((total / qty) * 100) / 100;
  return 0;
}

function lineUnitCost(record: UnknownRecord, qty: number, sell: number) {
  const direct = money(record, [
    "CostPrice.ExTax",
    "CostPrice",
    "BasePrice.ExTax",
    "BasePrice",
    "EstimatedCost.ExTax",
    "EstimatedCost",
    "ActualCost.ExTax",
    "ActualCost",
    "BuyPrice.ExTax",
    "BuyPrice",
    "NettPrice.ExTax",
    "NettPrice",
    "LaborCost",
    "LabourCost",
    "CostRate",
    "LaborRate.Cost",
    "LabourRate.Cost",
    "Cost.ExTax",
    "Cost",
    "UnitCost.ExTax",
    "UnitCost",
    "Total.BasePrice.ExTax",
    "Total.EstimatedCost.ExTax",
    "Total.CostPrice.ExTax",
  ], Number.NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;
  // LaborRate is often the charge rate on quote labour lines — only treat as cost when no sell was found.
  const labourRate = money(record, ["LaborRate", "LabourRate"], Number.NaN);
  if (Number.isFinite(labourRate) && labourRate > 0 && !(sell > 0 && labourRate === sell)) {
    // If SellPrice exists separately, LaborRate is typically the cost/base rate on some builds.
    const hasExplicitSell = Number.isFinite(
      money(record, ["SellPrice.ExTax", "SellPrice", "UnitPrice.ExTax", "UnitPrice"], Number.NaN),
    );
    if (hasExplicitSell) return labourRate;
  }
  const totalCost = money(
    record,
    [
      "Total.Cost.ExTax",
      "Total.Cost",
      "Total.EstimatedCost.ExTax",
      "Total.EstimatedCost",
      "Total.BasePrice.ExTax",
      "Total.BasePrice",
      "CostTotal.ExTax",
      "CostTotal",
    ],
    Number.NaN,
  );
  if (Number.isFinite(totalCost) && qty > 0) return Math.round((totalCost / qty) * 100) / 100;
  // Do not copy sell into cost — that made cost price and charge price look identical.
  void sell;
  return 0;
}

function catalogueId(record: UnknownRecord) {
  return (
    firstString(record, [
      "Catalogue.ID",
      "Catalog.ID",
      "CatalogID",
      "CatalogueID",
      "PartNo",
      "SKU",
      "Stock.ID",
    ]) || ""
  );
}

function mapQuoteLine(record: UnknownRecord, centreId: string, index: number): MappedQuoteCostLine {
  const labour = isLabourItem(record);
  const quantity = lineQuantity(record);
  const unitSell = lineUnitSell(record, quantity);
  const unitCost = lineUnitCost(record, quantity, unitSell);
  const id = simproRecordId(record) || `${centreId}-line-${index + 1}`;
  return {
    id: `simpro-${id}`,
    catalogItemId: labour
      ? `labour-simpro-${catalogueId(record) || id}`
      : catalogueId(record)
        ? `material-simpro-${catalogueId(record)}`
        : `oneoff-simpro-${id}`,
    description: lineDescription(record, labour),
    quantity,
    unitCost,
    unitSell,
    supplierRequired: !labour && Boolean(catalogueId(record)),
  };
}

function mapJobMaterial(record: UnknownRecord, centreId: string, index: number): MappedEstimateMaterialLine {
  const quantity = lineQuantity(record);
  const unitSell = lineUnitSell(record, quantity);
  const unitCost = lineUnitCost(record, quantity, unitSell);
  const id = simproRecordId(record) || `${centreId}-mat-${index + 1}`;
  return {
    id: `simpro-${id}`,
    catalogItemId: catalogueId(record) ? `material-simpro-${catalogueId(record)}` : `oneoff-simpro-${id}`,
    description: lineDescription(record, false),
    quantity,
    unitCost,
    markupPercent: markupPercent(unitCost, unitSell),
    supplierRequired: Boolean(catalogueId(record)),
    rateSource: "manual",
  };
}

function mapJobLabour(record: UnknownRecord, centreId: string, index: number): MappedEstimateLabourLine {
  const hours = lineQuantity(record);
  const unitSell = lineUnitSell(record, hours);
  const costRate = lineUnitCost(record, hours, unitSell);
  const id = simproRecordId(record) || `${centreId}-lab-${index + 1}`;
  return {
    id: `simpro-${id}`,
    catalogItemId: `labour-simpro-${catalogueId(record) || id}`,
    role: lineDescription(record, true),
    hours,
    costRate,
    markupPercent: markupPercent(costRate, unitSell),
    rateSource: "manual",
  };
}

function costCentreName(costCenter: UnknownRecord, sectionName: string, index: number) {
  // Prefer the slot/setup name — Description is the brief, not the label.
  return (
    firstString(costCenter, ["Name", "CostCenter.Name", "CostCentre.Name"]) ||
    sectionName ||
    `Cost centre ${index + 1}`
  );
}

function normaliseBrief(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Simpro stores one Description on the cost centre. When NeXa pushed the centre,
 * that field is usually `name\n\nclientDescription\n\nengineerDescription`.
 * Native Simpro centres usually have a single free-text Description.
 */
export function splitCostCentreDescriptions(
  costCenter: UnknownRecord,
  centreName: string,
  sectionDescription = "",
): { clientDescription: string; engineerDescription: string } {
  const dedicatedClient = stripHtml(
    firstString(costCenter, ["ClientDescription", "CustomerDescription", "ClientNotes"]),
  );
  const dedicatedEngineer = stripHtml(
    firstString(costCenter, ["EngineerDescription", "TechnicianNotes", "InternalNotes"]),
  );
  const raw = stripHtml(firstString(costCenter, ["Description", "Notes", "LongDescription"]));
  const sectionBrief = stripHtml(sectionDescription);

  if (dedicatedClient || dedicatedEngineer) {
    return {
      clientDescription: dedicatedClient || raw || sectionBrief,
      engineerDescription: dedicatedEngineer || dedicatedClient || raw || sectionBrief,
    };
  }

  if (!raw) {
    return {
      clientDescription: sectionBrief,
      engineerDescription: sectionBrief,
    };
  }

  const parts = raw
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 3 && normaliseBrief(parts[0] || "") === normaliseBrief(centreName)) {
    return {
      clientDescription: parts[1] || "",
      engineerDescription: parts.slice(2).join("\n\n"),
    };
  }

  if (parts.length >= 2) {
    // First block often repeats the centre name when pushed from NeXa.
    if (normaliseBrief(parts[0] || "") === normaliseBrief(centreName)) {
      const rest = parts.slice(1);
      if (rest.length >= 2) {
        return {
          clientDescription: rest[0] || "",
          engineerDescription: rest.slice(1).join("\n\n"),
        };
      }
      return {
        clientDescription: rest[0] || "",
        engineerDescription: rest[0] || "",
      };
    }
    return {
      clientDescription: parts[0] || "",
      engineerDescription: parts.slice(1).join("\n\n"),
    };
  }

  return {
    clientDescription: raw,
    engineerDescription: raw,
  };
}

export function extractSimproSections(record: UnknownRecord): UnknownRecord[] {
  if (Array.isArray(record.Sections) && record.Sections.length) {
    return record.Sections.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  }
  // Some tenants return cost centres at the quote/job root with no Sections array.
  const rootCenters = Array.isArray(record.CostCenters)
    ? record.CostCenters
    : Array.isArray(record.CostCentres)
      ? record.CostCentres
      : [];
  if (rootCenters.length) {
    return [
      {
        ID: "root",
        Name: firstString(record, ["Name", "Title"]) || "Main",
        CostCenters: rootCenters,
      },
    ];
  }
  return [];
}

function sectionCostCenters(section: UnknownRecord): UnknownRecord[] {
  if (Array.isArray(section.CostCenters)) {
    return section.CostCenters.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  }
  if (Array.isArray(section.CostCentres)) {
    return section.CostCentres.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  }
  return [];
}

export function mapSimproQuoteCostCentres(
  record: UnknownRecord,
  nexaQuoteId: string,
): { centres: MappedQuoteCostCentre[]; stats: HierarchyStats } {
  const sections = extractSimproSections(record);
  const centres: MappedQuoteCostCentre[] = [];
  let materialLines = 0;
  let labourLines = 0;

  sections.forEach((section, sectionIndex) => {
    const sectionId = simproRecordId(section) || `section-${sectionIndex + 1}`;
    const sectionName = firstString(section, ["Name", "Description"]) || `Section ${sectionIndex + 1}`;
    const costCenters = sectionCostCenters(section);

    costCenters.forEach((costCenter, ccIndex) => {
      const ccId = simproRecordId(costCenter) || `${sectionId}-cc-${ccIndex + 1}`;
      const name = costCentreName(costCenter, sectionName, ccIndex);
      const briefs = splitCostCentreDescriptions(
        costCenter,
        name,
        firstString(section, ["Description", "Notes"]),
      );
      const items = itemCollections(costCenter);
      const lines: MappedQuoteCostLine[] = [];

      items.forEach((item, itemIndex) => {
        const line = mapQuoteLine(item, ccId, itemIndex);
        lines.push(line);
        if (isLabourItem(item)) labourLines += 1;
        else materialLines += 1;
      });

      centres.push({
        id: `${nexaQuoteId}-simpro-cc-${ccId}`,
        name,
        sectionId: `${nexaQuoteId}-simpro-section-${sectionId}`,
        sectionName,
        templateName: firstString(costCenter, ["CostCenter.Name", "CostCentre.Name"]) || undefined,
        clientDescription: briefs.clientDescription,
        engineerDescription: briefs.engineerDescription,
        lines,
        simproSectionId: sectionId,
        simproCostCentreId: ccId,
      });
    });
  });

  return {
    centres,
    stats: {
      sections: sections.length,
      costCentres: centres.length,
      materialLines,
      labourLines,
    },
  };
}

export function mapSimproJobCostCentres(
  record: UnknownRecord,
  nexaJobId: string,
): { centres: MappedJobCostCentre[]; stats: HierarchyStats } {
  const sections = extractSimproSections(record);
  const centres: MappedJobCostCentre[] = [];
  let materialLines = 0;
  let labourLines = 0;

  sections.forEach((section, sectionIndex) => {
    const sectionId = simproRecordId(section) || `section-${sectionIndex + 1}`;
    const sectionName = firstString(section, ["Name", "Description"]) || `Section ${sectionIndex + 1}`;
    const costCenters = sectionCostCenters(section);

    costCenters.forEach((costCenter, ccIndex) => {
      const ccId = simproRecordId(costCenter) || `${sectionId}-cc-${ccIndex + 1}`;
      const name = costCentreName(costCenter, sectionName, ccIndex);
      const briefs = splitCostCentreDescriptions(
        costCenter,
        name,
        firstString(section, ["Description", "Notes"]),
      );
      const items = itemCollections(costCenter);
      const materials: MappedEstimateMaterialLine[] = [];
      const labour: MappedEstimateLabourLine[] = [];

      items.forEach((item, itemIndex) => {
        if (isLabourItem(item)) {
          labour.push(mapJobLabour(item, ccId, itemIndex));
          labourLines += 1;
        } else {
          materials.push(mapJobMaterial(item, ccId, itemIndex));
          materialLines += 1;
        }
      });

      centres.push({
        id: `${nexaJobId}-simpro-cc-${ccId}`,
        name,
        sectionId: `${nexaJobId}-simpro-section-${sectionId}`,
        templateName: firstString(costCenter, ["CostCenter.Name", "CostCentre.Name"]) || undefined,
        clientDescription: briefs.clientDescription,
        engineerDescription: briefs.engineerDescription,
        materials,
        labour,
        simproSectionId: sectionId,
        simproCostCentreId: ccId,
      });
    });
  });

  return {
    centres,
    stats: {
      sections: sections.length,
      costCentres: centres.length,
      materialLines,
      labourLines,
    },
  };
}

function parseReferenceParts(reference: string) {
  // Job/Quote cost-centre schedules use "{jobOrQuoteId}-{costCenterId}".
  const match = reference.trim().match(/^(\d+)\s*-\s*(\d+)/);
  if (!match) return { recordId: "", costCentreId: "" };
  return { recordId: match[1] || "", costCentreId: match[2] || "" };
}

/** True when a schedule list row belongs to this simPRO job (avoids `21` matching `210787-…`). */
export function scheduleBelongsToSimproJob(record: UnknownRecord, simproJobId: string) {
  const jobId = String(simproJobId || "").trim();
  if (!jobId) return false;
  if (String(record.JobID ?? record.JobId ?? "") === jobId) return true;
  const reference = firstString(record, ["Reference", "Project"]);
  if (!reference) {
    const type = firstString(record, ["Type"]).toLowerCase();
    return type === "job";
  }
  return reference === jobId || reference.startsWith(`${jobId}-`);
}

function extractClockTime(value: string) {
  const trimmed = value.trim();
  if (/^\d{1,2}:\d{2}/.test(trimmed)) {
    const [hours = "0", minutes = "00"] = trimmed.split(":");
    return `${hours.padStart(2, "0")}:${minutes.slice(0, 2)}`;
  }
  const iso = trimmed.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  return "";
}

export function blockTimes(blocks: unknown): { startTime: string; endTime: string; hours: number } {
  if (!Array.isArray(blocks) || !blocks.length) {
    return { startTime: "08:00", endTime: "16:00", hours: 8 };
  }
  const first = asRecord(blocks[0]) ?? {};
  const last = asRecord(blocks[blocks.length - 1]) ?? first;
  const startTime =
    extractClockTime(firstString(first, ["StartTime", "ISO8601StartTime"])) || "08:00";
  const endTime =
    extractClockTime(firstString(last, ["EndTime", "ISO8601EndTime"])) || "16:00";
  const hours =
    blocks.reduce((sum, block) => sum + asNumber(asRecord(block)?.Hrs, 0), 0) ||
    asNumber(first.Hrs, 0) ||
    8;
  return { startTime, endTime, hours };
}

function resolveScheduleStaff(record: UnknownRecord): { employeeId: string; employeeName: string } {
  const staffRaw = record.Staff;
  if (typeof staffRaw === "number" && Number.isFinite(staffRaw) && staffRaw > 0) {
    return {
      employeeId: `simpro-staff-${Math.trunc(staffRaw)}`,
      employeeName: "Engineer to confirm",
    };
  }
  if (typeof staffRaw === "string" && /^\d+$/.test(staffRaw.trim())) {
    return {
      employeeId: `simpro-staff-${staffRaw.trim()}`,
      employeeName: "Engineer to confirm",
    };
  }
  const staff = asRecord(staffRaw) ?? {};
  const staffId = firstString(staff, ["ID", "Id", "id"]);
  const employeeName =
    firstString(staff, ["Name", "DisplayName"]) ||
    [firstString(staff, ["FirstName"]), firstString(staff, ["Surname", "LastName"])].filter(Boolean).join(" ") ||
    "Engineer to confirm";
  return {
    employeeId: staffId ? `simpro-staff-${staffId}` : "",
    employeeName,
  };
}

export function mapSimproJobSchedules(
  records: UnknownRecord[],
  nexaJobId: string,
  centres: MappedJobCostCentre[],
): MappedJobScheduleAssignment[] {
  const bySimproCc = new Map(centres.map((centre) => [centre.simproCostCentreId || "", centre]));
  const assignments: MappedJobScheduleAssignment[] = [];

  records.forEach((record, index) => {
    const reference = firstString(record, ["Reference", "Project"]);
    const parts = parseReferenceParts(reference);
    const centre =
      (parts.costCentreId && bySimproCc.get(parts.costCentreId)) ||
      centres[0] ||
      null;
    const date = firstString(record, ["Date"]).slice(0, 10);
    if (!date) return;
    const times = blockTimes(record.Blocks);
    const staff = resolveScheduleStaff(record);
    const scheduleId = simproRecordId(record) || `schedule-${index + 1}`;
    const plannedHours =
      asNumber(record.TotalHours, Number.NaN) ||
      times.hours ||
      8;

    assignments.push({
      id: `simpro-schedule-${scheduleId}`,
      jobId: nexaJobId,
      costCentreId: centre?.id || `${nexaJobId}-unassigned`,
      costCentreName: centre?.name || "Imported schedule",
      employeeId: staff.employeeId,
      employeeName: staff.employeeName,
      startDate: date,
      startTime: times.startTime,
      endDate: date,
      endTime: times.endTime,
      plannedHours,
      notes: stripHtml(firstString(record, ["Notes", "Project"])) || "Imported from simPRO",
      simproScheduleId: scheduleId,
    });
  });

  return assignments;
}

function mapInvoiceStatus(value: string): MappedInvoice["status"] {
  const status = value.toLowerCase();
  if (status.includes("cancel") || status.includes("void")) return "Cancelled";
  if (status.includes("paid") && status.includes("part")) return "Partially paid";
  if (status.includes("paid")) return "Paid";
  if (status.includes("sent") || status.includes("issue") || status.includes("approv")) return "Sent";
  return "Draft";
}

function mapInvoiceLineCategory(description: string): MappedInvoiceLine["category"] {
  const value = description.toLowerCase();
  if (value.includes("labour") || value.includes("labor")) return "Labour";
  if (value.includes("variation") || value.includes("extra")) return "Variations";
  if (value.includes("material") || value.includes("part") || value.includes("plant")) return "Materials";
  return "Other";
}

export function mapSimproInvoice(record: UnknownRecord): MappedInvoice | null {
  const externalId = simproRecordId(record);
  if (!externalId) return null;

  const number =
    firstString(record, ["InvoiceNo", "Number", "DisplayName", "Name"]) || `INV-SIMPRO-${externalId}`;
  const customer =
    firstString(record, [
      "Customer.CompanyName",
      "Customer.Name",
      "CustomerName",
      "Client.Name",
      "CompanyName",
    ]) || "Simpro customer";
  const description =
    stripHtml(firstString(record, ["Description", "Name", "Title", "Notes"])) || `Invoice ${number}`;

  const nestedLines = Array.isArray(record.Items)
    ? record.Items
    : Array.isArray(record.Lines)
      ? record.Lines
      : Array.isArray(asRecord(record.Items)?.OneOffs)
        ? (asRecord(record.Items)?.OneOffs as unknown[])
        : [];

  const lines: MappedInvoiceLine[] = [];
  nestedLines.forEach((row, index) => {
    const item = asRecord(row);
    if (!item) return;
    const qty = lineQuantity(item);
    const unitSell = lineUnitSell(item, qty);
    const unitCost = lineUnitCost(item, qty, unitSell);
    const desc = lineDescription(item, isLabourItem(item));
    lines.push({
      id: `simpro-inv-line-${simproRecordId(item) || index + 1}`,
      description: desc,
      category: isLabourItem(item) ? "Labour" : mapInvoiceLineCategory(desc),
      costToUs: Math.round(unitCost * qty * 100) / 100,
      chargeToClient: Math.round(unitSell * qty * 100) / 100,
      note: firstString(item, ["CostCenter.Name", "Section.Name"]) || undefined,
    });
  });

  const chargeTotal =
    money(record, ["Total.ExTax", "TotalPrice", "Amount.ExTax", "Amount", "Total"], Number.NaN) ||
    lines.reduce((sum, line) => sum + line.chargeToClient, 0);
  const costTotal = lines.reduce((sum, line) => sum + line.costToUs, 0) || chargeTotal;

  if (!lines.length && chargeTotal > 0) {
    lines.push({
      id: `simpro-inv-line-${externalId}-total`,
      description,
      category: "Other",
      costToUs: costTotal,
      chargeToClient: chargeTotal,
      note: "Imported simPRO invoice total",
    });
  }

  const jobId = firstString(record, ["Job.ID", "JobID", "Jobs.0.ID"]);
  const quoteId = firstString(record, ["Quote.ID", "QuoteID"]);

  return {
    externalId,
    externalNumber: number,
    status: mapInvoiceStatus(firstString(record, ["Status.Name", "Status", "Stage.Name", "Stage"])),
    customer,
    issuedDate: firstString(record, ["DateIssued", "IssuedDate", "Date", "CreatedDate"]).slice(0, 10) || new Date().toISOString().slice(0, 10),
    dueDate: firstString(record, ["DateDue", "DueDate", "PaymentDue"]).slice(0, 10) || new Date().toISOString().slice(0, 10),
    title: description,
    lines,
    costTotal: Math.round(costTotal * 100) / 100,
    chargeTotal: Math.round(chargeTotal * 100) / 100,
    notes: `Imported from simPRO invoice ${number}.`,
    simproJobId: jobId || undefined,
    simproQuoteId: quoteId || undefined,
    sourceModifiedAt: firstString(record, ["DateModified", "Modified", "UpdatedAt"]) || undefined,
  };
}

export function summariseHierarchyStats(stats: HierarchyStats) {
  return `${stats.costCentres} cost centre${stats.costCentres === 1 ? "" : "s"} · ${stats.materialLines} material · ${stats.labourLines} labour`;
}
