/**
 * Build Core job sections + cost centres from a tender BoQ.
 * Sections = floors / flats; cost centres = services (Heating, Hot & cold, …).
 */

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { TAKEOFF_BOQ_SHEET_PREFIX } from "@/lib/takeoff-tender-export";
import {
  floorLabelSortKey,
  inferFloorLabelFromDrawingName,
} from "@/lib/takeoff-studio-pipe";
import { resolveBoqLineSection } from "@/lib/tender-boq-sections";
import { computeBoqTotal, type TenderBoqLine } from "@/lib/tenders-types";
import { updateJob, type Job } from "@/lib/workflow-data";

export type TenderJobSection = {
  id: string;
  name: string;
  description: string;
};

export type TenderJobMaterialLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
};

export type TenderJobCostCentre = {
  id: string;
  name: string;
  sectionId: string;
  templateName?: string;
  clientDescription: string;
  engineerDescription: string;
  materials: TenderJobMaterialLine[];
  labour: Array<{
    id: string;
    catalogItemId?: string;
    role: string;
    hours: number;
    costRate: number;
    markupPercent: number;
  }>;
};

export type TenderJobStructure = {
  sections: TenderJobSection[];
  costCentres: TenderJobCostCentre[];
  totalSell: number;
};

const INTERNAL_SECTION_LABELS = new Set([
  "pipework",
  "fittings",
  "counts",
  "areas",
  "assemblies",
  "boq",
]);

const SERVICE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /hot\s*&\s*cold|hot\s+and\s+cold|h\s*&\s*c\b/i, label: "Hot & cold" },
  { re: /\bheating\b|lthw|radiator|underfloor/i, label: "Heating" },
  { re: /\bgas\b/i, label: "Gas" },
  { re: /sanitary|waste|drainage|soil\b/i, label: "Sanitary & waste" },
  { re: /\bplumb/i, label: "Plumbing" },
  { re: /\belectr/i, label: "Electrical" },
  { re: /\bventilat|mvhr|extract/i, label: "Ventilation" },
];

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function slug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "item"
  );
}

function stripTakeoffPrefix(sheet: string) {
  const trimmed = sheet.trim();
  if (trimmed.startsWith(TAKEOFF_BOQ_SHEET_PREFIX)) {
    return trimmed.slice(TAKEOFF_BOQ_SHEET_PREFIX.length).trim() || "Takeoff";
  }
  if (/^takeoff$/i.test(trimmed)) return "Takeoff";
  return trimmed;
}

function isInternalSectionLabel(label: string) {
  return INTERNAL_SECTION_LABELS.has(label.trim().toLowerCase());
}

function normalizeFloorLabel(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const inferred = inferFloorLabelFromDrawingName(trimmed);
  if (inferred !== "Unspecified floor") return inferred;
  if (/^(lower\s*ground|ground|first|second|third|fourth|basement|flat\b)/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, " ");
  }
  return null;
}

function looksLikeFloorLabel(label: string) {
  return Boolean(normalizeFloorLabel(label));
}

function matchKnownService(label: string): string | null {
  const text = stripTakeoffPrefix(label);
  for (const item of SERVICE_PATTERNS) {
    if (item.re.test(text)) return item.label;
  }
  return null;
}

function lineAmount(line: TenderBoqLine): number | null {
  if (line.kind !== "measured") return null;
  const hasRate = typeof line.rate === "number" && Number.isFinite(line.rate);
  const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
  if (!hasRate && !hasValue) return null;
  if (hasValue) return roundMoney(line.value!);
  const qty = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 1;
  return roundMoney(line.rate! * qty);
}

function lineUnitCostAndQty(line: TenderBoqLine): { quantity: number; unitCost: number } {
  const amount = lineAmount(line) ?? 0;
  const qty =
    typeof line.quantity === "number" && Number.isFinite(line.quantity) && line.quantity !== 0
      ? line.quantity
      : 1;
  if (typeof line.rate === "number" && Number.isFinite(line.rate)) {
    return { quantity: qty, unitCost: roundMoney(line.rate) };
  }
  return { quantity: qty, unitCost: roundMoney(amount / qty) };
}

function nearestFloorHeader(lines: TenderBoqLine[], index: number): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const prior = lines[i];
    if (!prior || prior.kind !== "header") continue;
    if (prior.sheet && lines[index]?.sheet && prior.sheet !== lines[index]?.sheet) continue;
    const label = (prior.section || prior.description || "").trim();
    if (!label || isInternalSectionLabel(label)) continue;
    const floor = normalizeFloorLabel(label);
    if (floor) return floor;
  }
  return null;
}

function resolvePlacement(lines: TenderBoqLine[], index: number): { location: string; service: string } {
  const line = lines[index]!;
  const sheet = (line.sheet || "").trim();
  const noteHead = (line.note || "").split(/\s*·\s*/)[0]?.trim() || "";
  const sectionLabel = resolveBoqLineSection(lines, index).trim();
  const sheetService = sheet.startsWith(TAKEOFF_BOQ_SHEET_PREFIX) || /^takeoff$/i.test(sheet)
    ? stripTakeoffPrefix(sheet)
    : matchKnownService(sheet);

  let location =
    normalizeFloorLabel(noteHead) ||
    (!isInternalSectionLabel(sectionLabel) ? normalizeFloorLabel(sectionLabel) : null) ||
    nearestFloorHeader(lines, index) ||
    normalizeFloorLabel(sheet) ||
    "General";

  let service =
    sheetService ||
    matchKnownService(sheet) ||
    (!isInternalSectionLabel(sectionLabel) && !looksLikeFloorLabel(sectionLabel)
      ? matchKnownService(sectionLabel) || (sectionLabel || null)
      : null) ||
    (sheet && !looksLikeFloorLabel(sheet) ? stripTakeoffPrefix(sheet) : null) ||
    "General";

  // Sheet like "Ground Floor Heating" — pull both sides when still generic.
  if (sheet) {
    const floorFromSheet = normalizeFloorLabel(sheet);
    const serviceFromSheet = matchKnownService(sheet);
    if (floorFromSheet && location === "General") location = floorFromSheet;
    if (serviceFromSheet && (service === "General" || service === sheet)) service = serviceFromSheet;
  }

  return { location, service };
}

/** Pure builder — floors as sections, services as cost centres, amounts match BoQ sell. */
export function buildJobStructureFromTenderBoq(
  job: Pick<Job, "id" | "ref" | "description">,
  lines: TenderBoqLine[],
): TenderJobStructure {
  type Bucket = {
    location: string;
    service: string;
    materials: TenderJobMaterialLine[];
    sell: number;
  };

  const buckets = new Map<string, Bucket>();
  let totalSell = 0;

  lines.forEach((line, index) => {
    if (line.kind !== "measured") return;
    const amount = lineAmount(line);
    if (amount === null) return;
    const { location, service } = resolvePlacement(lines, index);
    const key = `${location.toLowerCase()}||${service.toLowerCase()}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { location, service, materials: [], sell: 0 };
      buckets.set(key, bucket);
    }
    const priced = lineUnitCostAndQty(line);
    bucket.materials.push({
      id: `${job.id}-tender-${line.id}`,
      catalogItemId: "tender-boq",
      description: [line.ref, line.description].filter(Boolean).join(" — ") || line.description,
      quantity: priced.quantity,
      unitCost: priced.unitCost,
      markupPercent: 0,
    });
    bucket.sell = roundMoney(bucket.sell + amount);
    totalSell = roundMoney(totalSell + amount);
  });

  if (!buckets.size) {
    const boqTotal = computeBoqTotal(lines);
    const sectionId = `${job.id}-section-general`;
    return {
      sections: [{ id: sectionId, name: "General", description: "From won tender BoQ" }],
      costCentres: [
        {
          id: `${job.id}-cc-boq`,
          name: "Tender BoQ",
          sectionId,
          templateName: "Tender BoQ",
          clientDescription: job.description || "Won tender",
          engineerDescription: "Generated from tender BoQ on Mark Won.",
          materials:
            boqTotal > 0
              ? [
                  {
                    id: `${job.id}-tender-boq-lump`,
                    catalogItemId: "tender-boq",
                    description: "Tender BoQ total",
                    quantity: 1,
                    unitCost: boqTotal,
                    markupPercent: 0,
                  },
                ]
              : [],
          labour: [],
        },
      ],
      totalSell: boqTotal,
    };
  }

  const locationNames = Array.from(
    new Set(Array.from(buckets.values()).map((bucket) => bucket.location)),
  ).sort((a, b) => floorLabelSortKey(a) - floorLabelSortKey(b) || a.localeCompare(b));

  const sections: TenderJobSection[] = locationNames.map((name) => ({
    id: `${job.id}-section-${slug(name)}`,
    name,
    description: "From won tender BoQ",
  }));
  const sectionIdByName = new Map(sections.map((section) => [section.name, section.id]));

  const costCentres: TenderJobCostCentre[] = Array.from(buckets.values())
    .sort((a, b) => {
      const floor = floorLabelSortKey(a.location) - floorLabelSortKey(b.location);
      if (floor !== 0) return floor;
      return a.service.localeCompare(b.service) || a.location.localeCompare(b.location);
    })
    .map((bucket) => {
      const sectionId = sectionIdByName.get(bucket.location) || sections[0]!.id;
      return {
        id: `${job.id}-cc-${slug(bucket.location)}-${slug(bucket.service)}`,
        name: bucket.service,
        sectionId,
        templateName: bucket.service,
        clientDescription: `${bucket.location} · ${bucket.service}`,
        engineerDescription: `Built from tender BoQ (${bucket.materials.length} priced line(s)).`,
        materials: bucket.materials,
        labour: [],
      };
    });

  return { sections, costCentres, totalSell };
}

function asMap(value: unknown): Record<string, unknown[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown[]>;
}

function isDayworkCentre(centre: Record<string, unknown>) {
  const id = String(centre.id || "");
  return (
    id.includes("daywork") ||
    /daywork/i.test(String(centre.name || "")) ||
    /daywork/i.test(String(centre.templateName || ""))
  );
}

/** Persist BoQ-built structure onto a job; keeps daywork centres; syncs job.value to BoQ total. */
export function applyTenderBoqStructureToJob(
  job: Job,
  lines: TenderBoqLine[],
  options?: { replace?: boolean },
): TenderJobStructure & { job: Job } {
  const structure = buildJobStructureFromTenderBoq(job, lines);
  const hub = getHubDetailState();
  const jobCostCentres = { ...asMap(hub.jobCostCentres) };
  const jobSections = { ...asMap(hub.jobSections) };

  const existingCentres = Array.isArray(jobCostCentres[job.id])
    ? (jobCostCentres[job.id] as Array<Record<string, unknown>>)
    : [];
  const dayworkKept = existingCentres.filter((centre) => isDayworkCentre(centre));
  const replace = options?.replace !== false;
  if (replace || existingCentres.length === 0) {
    jobCostCentres[job.id] = [...structure.costCentres, ...dayworkKept];
    jobSections[job.id] = structure.sections;
  } else {
    return { ...structure, job };
  }

  saveHubDetailState({
    ...hub,
    jobCostCentres,
    jobSections,
  });

  const nextValue = structure.totalSell > 0 ? structure.totalSell : job.value;
  const updated =
    nextValue !== job.value
      ? updateJob(job.id, { value: nextValue }) || job
      : job;

  return { ...structure, job: updated };
}
