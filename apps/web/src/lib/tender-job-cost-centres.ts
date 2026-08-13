/**
 * Build Core job sections + cost centres from tender BoQ sheet totals only.
 * Never copies BoQ lines onto job centre materials[] (always empty).
 */

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import {
  LEAN_MAX_MATERIALS_PER_CENTRE,
  LEAN_MAX_MATERIALS_PER_JOB,
  LEAN_REBUILD_NOTICE,
  aggregateBoqSheetTotals,
  leanCentresForTransport,
  leanJobCostCentresList,
  leanRoundMoney,
  stripCentresToEmptyMaterials,
  type BoqSheetTotal,
} from "@/lib/job-cost-centres-lean";
import { TAKEOFF_BOQ_SHEET_PREFIX } from "@/lib/takeoff-tender-export";
import {
  floorLabelSortKey,
  inferFloorLabelFromDrawingName,
} from "@/lib/takeoff-studio-pipe";
import type { TenderBoqLine } from "@/lib/tenders-types";
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
  return leanRoundMoney(value);
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

/** Soft cap — anything larger is collapsed on read. */
export const MAX_TENDER_BOQ_MATERIALS_PER_CENTRE = LEAN_MAX_MATERIALS_PER_CENTRE;
/** Across a whole job — beyond this, heal collapses centres. */
export const MAX_TENDER_BOQ_MATERIALS_PER_JOB = LEAN_MAX_MATERIALS_PER_JOB;

/** Ensure centres always have arrays and finite numbers — never hydrate full BoQ dumps. */
export function sanitizeJobCostCentres(
  centres: unknown,
  jobId = "job",
  options?: { emptyMaterials?: boolean },
): TenderJobCostCentre[] {
  const emptyMaterials = options?.emptyMaterials === true;
  const leaned = leanJobCostCentresList(jobId, centres, {
    maxPerCentre: MAX_TENDER_BOQ_MATERIALS_PER_CENTRE,
    maxPerJob: MAX_TENDER_BOQ_MATERIALS_PER_JOB,
    emptyMaterials,
  });
  const cleaned: TenderJobCostCentre[] = [];
  for (const centre of leaned.centres) {
    const id = typeof centre.id === "string" && centre.id.trim() ? centre.id.trim() : "";
    if (!id) continue;
    const materialsRaw = Array.isArray(centre.materials) ? centre.materials : [];
    const labourRaw = Array.isArray(centre.labour) ? centre.labour : [];
    const materials: TenderJobMaterialLine[] = [];
    if (!emptyMaterials) {
      for (const row of materialsRaw) {
        if (!row || typeof row !== "object") continue;
        const line = row as Record<string, unknown>;
        const lineId = typeof line.id === "string" && line.id ? line.id : `${id}-mat-${materials.length}`;
        const quantity = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 0;
        const unitCost = typeof line.unitCost === "number" && Number.isFinite(line.unitCost) ? line.unitCost : 0;
        const markupPercent =
          typeof line.markupPercent === "number" && Number.isFinite(line.markupPercent) ? line.markupPercent : 0;
        materials.push({
          id: lineId,
          catalogItemId: typeof line.catalogItemId === "string" ? line.catalogItemId : "tender-boq",
          description: String(line.description || "BoQ line"),
          quantity,
          unitCost,
          markupPercent,
        });
      }
    }
    const labour = labourRaw
      .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
      .map((line, index) => ({
        id: typeof line.id === "string" && line.id ? line.id : `${id}-lab-${index}`,
        catalogItemId: typeof line.catalogItemId === "string" ? line.catalogItemId : undefined,
        role: String(line.role || "Labour"),
        hours: typeof line.hours === "number" && Number.isFinite(line.hours) ? line.hours : 0,
        costRate: typeof line.costRate === "number" && Number.isFinite(line.costRate) ? line.costRate : 0,
        markupPercent:
          typeof line.markupPercent === "number" && Number.isFinite(line.markupPercent) ? line.markupPercent : 0,
      }));
    cleaned.push({
      id,
      name: String(centre.name || "Cost centre"),
      sectionId: typeof centre.sectionId === "string" ? centre.sectionId : `${id}-section`,
      templateName: typeof centre.templateName === "string" ? centre.templateName : undefined,
      clientDescription: String(centre.clientDescription || ""),
      engineerDescription: String(centre.engineerDescription || ""),
      materials,
      labour,
    });
  }
  return cleaned;
}

export function sanitizeJobSections(sections: unknown, jobId: string): TenderJobSection[] {
  if (!Array.isArray(sections)) {
    return [{ id: `${jobId}-section-general`, name: "General", description: "From won tender BoQ" }];
  }
  const cleaned: TenderJobSection[] = [];
  for (const raw of sections) {
    if (!raw || typeof raw !== "object") continue;
    const section = raw as Record<string, unknown>;
    const id = typeof section.id === "string" && section.id.trim() ? section.id.trim() : "";
    if (!id) continue;
    cleaned.push({
      id,
      name: String(section.name || "Section"),
      description: String(section.description || ""),
    });
  }
  return cleaned.length
    ? cleaned
    : [{ id: `${jobId}-section-general`, name: "General", description: "From won tender BoQ" }];
}

/** Collapse oversized / corrupt centres so Jobs can open without white-screening. */
export function healJobCostCentresShape(
  jobId: string,
  centres: unknown,
  options?: { maxPerCentre?: number; maxPerJob?: number },
): { centres: TenderJobCostCentre[]; healed: boolean; reason?: string } {
  const inputList = Array.isArray(centres) ? centres : [];
  const inputWasCorrupt = inputList.some((row) => {
    if (!row || typeof row !== "object") return true;
    const centre = row as Record<string, unknown>;
    return !Array.isArray(centre.materials) || !Array.isArray(centre.labour);
  });
  const inputMaterialCount = inputList.reduce((sum, row) => {
    if (!row || typeof row !== "object") return sum;
    const materials = (row as { materials?: unknown }).materials;
    return sum + (Array.isArray(materials) ? materials.length : 0);
  }, 0);
  const stripped = stripCentresToEmptyMaterials(jobId, centres, {
    forceAll: true,
    reason: "no line dump",
  });
  const sanitized = sanitizeJobCostCentres(stripped.centres, jobId, { emptyMaterials: true });
  const healed =
    stripped.changed ||
    inputWasCorrupt ||
    sanitized.length !== inputList.length ||
    inputMaterialCount > 0;
  return {
    centres: sanitized,
    healed,
    reason: healed
      ? stripped.changed || inputMaterialCount > 0
        ? `stripped ${inputMaterialCount} material lines (nuclear lean · no line dump)`
        : "sanitized cost centre shape"
      : undefined,
  };
}

function placementFromSheetName(sheet: string): { location: string; service: string } {
  const label = stripTakeoffPrefix(sheet);
  const floor = normalizeFloorLabel(label) || normalizeFloorLabel(sheet);
  const service =
    matchKnownService(label) ||
    matchKnownService(sheet) ||
    (!looksLikeFloorLabel(label) && !isInternalSectionLabel(label) ? label : null) ||
    "General";
  const location = floor || "General";
  return { location, service };
}

/**
 * Build sections/centres from precomputed sheet totals only.
 * materials[] is always empty — sell lives on job.value + engineer note.
 */
export function buildJobStructureFromSheetTotals(
  job: Pick<Job, "id" | "ref" | "description">,
  sheets: BoqSheetTotal[],
  fallbackValue = 0,
): TenderJobStructure {
  type Bucket = { location: string; service: string; lineCount: number; sell: number; sheet: string };
  const buckets = new Map<string, Bucket>();
  let totalSell = 0;

  for (const row of sheets) {
    if (!row || !(row.sell > 0 || row.lineCount > 0)) continue;
    const { location, service } = placementFromSheetName(row.sheet || "General");
    const key = `${location.toLowerCase()}||${service.toLowerCase()}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { location, service, lineCount: 0, sell: 0, sheet: row.sheet || service };
      buckets.set(key, bucket);
    }
    bucket.lineCount += row.lineCount || 0;
    bucket.sell = roundMoney(bucket.sell + (row.sell || 0));
    totalSell = roundMoney(totalSell + (row.sell || 0));
  }

  if (!buckets.size) {
    const sell = roundMoney(fallbackValue);
    const sectionId = `${job.id}-section-general`;
    return {
      sections: [{ id: sectionId, name: "General", description: "From won tender BoQ (lean)" }],
      costCentres: [
        {
          id: `${job.id}-cc-boq`,
          name: "Tender BoQ",
          sectionId,
          templateName: "Tender BoQ",
          clientDescription: job.description || "Won tender",
          engineerDescription:
            sell > 0
              ? `Lean sheet total £${sell.toFixed(2)} (no line dump).`
              : "Lean tender stub (no line dump).",
          materials: [],
          labour: [],
        },
      ],
      totalSell: sell,
    };
  }

  const locationNames = Array.from(
    new Set(Array.from(buckets.values()).map((bucket) => bucket.location)),
  ).sort((a, b) => floorLabelSortKey(a) - floorLabelSortKey(b) || a.localeCompare(b));

  const sections: TenderJobSection[] = locationNames.map((name) => ({
    id: `${job.id}-section-${slug(name)}`,
    name,
    description: "From won tender BoQ (lean · sheet totals only)",
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
        engineerDescription: `Lean sheet total £${bucket.sell.toFixed(2)} (${bucket.lineCount} priced line(s) · no line dump).`,
        materials: [],
        labour: [],
      };
    });

  return { sections, costCentres, totalSell };
}

/**
 * Pure builder — sheet-name aggregates only; never attaches BoQ lines to materials[].
 * Streams line amounts into sheet totals then discards line bodies.
 */
export function buildJobStructureFromTenderBoq(
  job: Pick<Job, "id" | "ref" | "description">,
  lines: TenderBoqLine[],
): TenderJobStructure {
  const { sheets, totalSell } = aggregateBoqSheetTotals(lines);
  return buildJobStructureFromSheetTotals(job, sheets, totalSell);
}

/**
 * Preferred rebuild entry: sheet totals (+ optional job value fallback).
 * Does not accept or retain BoQ line objects.
 */
export function buildJobStructureFromLeanTenderInputs(
  job: Pick<Job, "id" | "ref" | "description" | "value">,
  input: { sheets?: BoqSheetTotal[]; totalSell?: number; jobValue?: number },
): TenderJobStructure {
  const sheets = Array.isArray(input.sheets) ? input.sheets : [];
  const fallback = roundMoney(
    typeof input.totalSell === "number" && Number.isFinite(input.totalSell)
      ? input.totalSell
      : typeof input.jobValue === "number" && Number.isFinite(input.jobValue)
        ? input.jobValue
        : job.value || 0,
  );
  if (!sheets.length && fallback > 0) {
    return buildJobStructureFromSheetTotals(
      job,
      [{ sheet: "General", sell: fallback, lineCount: 0 }],
      fallback,
    );
  }
  return buildJobStructureFromSheetTotals(job, sheets, fallback);
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

/** Persist lean structure onto a job; keeps daywork centres; syncs job.value to sheet total. */
export function applyTenderBoqStructureToJob(
  job: Job,
  lines: TenderBoqLine[],
  options?: { replace?: boolean },
): TenderJobStructure & { job: Job } {
  // Aggregate once — never map lines → materials[].
  const { sheets, totalSell } = aggregateBoqSheetTotals(lines);
  const built = buildJobStructureFromSheetTotals(job, sheets, totalSell || job.value || 0);
  return persistLeanJobStructure(job, built, options);
}

/** Persist from sheet totals only (no BoQ line array required). */
export function applyLeanSheetStructureToJob(
  job: Job,
  sheets: BoqSheetTotal[],
  options?: { replace?: boolean; totalSell?: number },
): TenderJobStructure & { job: Job } {
  const built = buildJobStructureFromSheetTotals(
    job,
    sheets,
    options?.totalSell ?? job.value ?? 0,
  );
  return persistLeanJobStructure(job, built, options);
}

function persistLeanJobStructure(
  job: Job,
  built: TenderJobStructure,
  options?: { replace?: boolean },
): TenderJobStructure & { job: Job } {
  const leanCentres = leanCentresForTransport(job.id, built.costCentres) as TenderJobCostCentre[];
  const structure: TenderJobStructure = {
    sections: sanitizeJobSections(built.sections, job.id),
    costCentres: sanitizeJobCostCentres(leanCentres, job.id, { emptyMaterials: true }),
    totalSell: built.totalSell,
  };
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

  console.info(`[hubflo] ${LEAN_REBUILD_NOTICE}`, {
    jobId: job.id,
    centres: structure.costCentres.length,
    totalSell: structure.totalSell,
  });

  return { ...structure, job: updated };
}

/**
 * Repair corrupt / oversized cost centres for an existing job (e.g. J-1103 after a heavy BoQ convert).
 * Safe to call on job open — no-op when already healthy.
 */
export function healStoredJobCostCentres(jobId: string): {
  healed: boolean;
  reason?: string;
  centres: TenderJobCostCentre[];
  sections: TenderJobSection[];
} {
  const hub = getHubDetailState();
  const existing = asMap(hub.jobCostCentres)[jobId];
  const existingSections = asMap(hub.jobSections)[jobId];
  const existingList = Array.isArray(existing) ? (existing as Array<Record<string, unknown>>) : [];
  const dayworkKept = existingList.filter((centre) => isDayworkCentre(centre));
  const nonDaywork = existingList.filter((centre) => !isDayworkCentre(centre));
  const result = healJobCostCentresShape(jobId, nonDaywork);
  const sections = sanitizeJobSections(existingSections, jobId);
  const nextCentres = [
    ...sanitizeJobCostCentres(leanCentresForTransport(jobId, result.centres), jobId, {
      emptyMaterials: true,
    }),
    ...sanitizeJobCostCentres(dayworkKept, jobId, { emptyMaterials: false }),
  ];
  const needsPersist =
    result.healed ||
    existingList.length !== nextCentres.length ||
    existingList.some((centre) => !Array.isArray(centre.materials) || !Array.isArray(centre.labour)) ||
    existingList.some((centre) => Array.isArray(centre.materials) && centre.materials.length > 0);
  if (!needsPersist) {
    return {
      healed: false,
      centres: nextCentres.length ? nextCentres : sanitizeJobCostCentres(existingList),
      sections,
    };
  }

  saveHubDetailState({
    ...hub,
    jobCostCentres: {
      ...asMap(hub.jobCostCentres),
      [jobId]: nextCentres,
    },
    jobSections: {
      ...asMap(hub.jobSections),
      [jobId]: sections,
    },
  });

  console.info(`[hubflo] healed lean centres (no line dump)`, { jobId, reason: result.reason });

  return {
    healed: true,
    reason: result.reason || "sanitized cost centre shape",
    centres: nextCentres,
    sections,
  };
}
