/**
 * Build Core job sections + cost centres from a tender BoQ.
 * Sections = floors / flats; cost centres = services (Heating, Hot & cold, …).
 */

import { getHubDetailState, writeJobCostCentresAndSections } from "@/lib/hub-detail-store";
import {
  LEAN_MAX_MATERIALS_PER_CENTRE,
  LEAN_MAX_MATERIALS_PER_JOB,
  LEAN_REBUILD_NOTICE,
  leanCentresForTransport,
  leanJobCostCentresList,
} from "@/lib/job-cost-centres-lean";
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

/** Tiny rebuild recipe — floors × services × totals. Never includes BoQ line arrays. */
export type TenderBoqRebuildBucket = {
  location: string;
  service: string;
  lineCount: number;
  sell: number;
};

export type TenderBoqRebuildSummary = {
  totalSell: number;
  lineCount: number;
  buckets: TenderBoqRebuildBucket[];
  updatedAt: string;
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

/** Soft cap — anything larger is collapsed to a single package line on read. */
export const MAX_TENDER_BOQ_MATERIALS_PER_CENTRE = LEAN_MAX_MATERIALS_PER_CENTRE;
/** Across a whole job — beyond this, heal collapses each centre to a lump line. */
export const MAX_TENDER_BOQ_MATERIALS_PER_JOB = LEAN_MAX_MATERIALS_PER_JOB;

/** Ensure centres always have arrays and finite numbers — never hydrate full BoQ dumps. */
export function sanitizeJobCostCentres(centres: unknown, jobId = "job"): TenderJobCostCentre[] {
  const leaned = leanJobCostCentresList(jobId, centres, {
    maxPerCentre: MAX_TENDER_BOQ_MATERIALS_PER_CENTRE,
    maxPerJob: MAX_TENDER_BOQ_MATERIALS_PER_JOB,
  });
  const cleaned: TenderJobCostCentre[] = [];
  for (const centre of leaned.centres) {
    const id = typeof centre.id === "string" && centre.id.trim() ? centre.id.trim() : "";
    if (!id) continue;
    const materialsRaw = Array.isArray(centre.materials) ? centre.materials : [];
    const labourRaw = Array.isArray(centre.labour) ? centre.labour : [];
    const materials: TenderJobMaterialLine[] = [];
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
  const maxPerCentre = options?.maxPerCentre ?? MAX_TENDER_BOQ_MATERIALS_PER_CENTRE;
  const maxPerJob = options?.maxPerJob ?? MAX_TENDER_BOQ_MATERIALS_PER_JOB;
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
  const leaned = leanJobCostCentresList(jobId, centres, { maxPerCentre, maxPerJob });
  const sanitized = sanitizeJobCostCentres(leaned.centres, jobId);
  const healed = leaned.changed || inputWasCorrupt || sanitized.length !== inputList.length;
  return {
    centres: sanitized,
    healed,
    reason: healed
      ? leaned.changed
        ? `collapsed ${inputMaterialCount} material lines to lean packages (cap ${maxPerCentre}/centre, ${maxPerJob}/job)`
        : "sanitized cost centre shape"
      : undefined,
  };
}

/** Summarise a Bill into tiny floor/service buckets (safe to persist beside the BoQ). */
export function summariseTenderBoqForRebuild(lines: TenderBoqLine[]): TenderBoqRebuildSummary {
  type Bucket = TenderBoqRebuildBucket;
  const buckets = new Map<string, Bucket>();
  let totalSell = 0;
  let lineCount = 0;

  lines.forEach((line, index) => {
    if (line.kind !== "measured") return;
    const amount = lineAmount(line);
    if (amount === null) return;
    const { location, service } = resolvePlacement(lines, index);
    const key = `${location.toLowerCase()}||${service.toLowerCase()}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { location, service, lineCount: 0, sell: 0 };
      buckets.set(key, bucket);
    }
    bucket.lineCount += 1;
    bucket.sell = roundMoney(bucket.sell + amount);
    totalSell = roundMoney(totalSell + amount);
    lineCount += 1;
  });

  if (!buckets.size) {
    const boqTotal = computeBoqTotal(lines);
    return {
      totalSell: boqTotal,
      lineCount: lines.filter((line) => line.kind === "measured").length,
      buckets:
        boqTotal > 0
          ? [{ location: "General", service: "Tender BoQ", lineCount: lineCount || 1, sell: boqTotal }]
          : [],
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    totalSell,
    lineCount,
    buckets: Array.from(buckets.values()),
    updatedAt: new Date().toISOString(),
  };
}

/** Crash-proof rebuild from tender total only — never needs BoQ lines in memory. */
export function buildJobStructureFromTenderTotal(
  job: Pick<Job, "id" | "ref" | "description">,
  totalSell: number,
): TenderJobStructure {
  const amount = roundMoney(Number.isFinite(totalSell) ? totalSell : 0);
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
          amount > 0
            ? `Lean sheet total £${amount.toFixed(2)} (no line dump).`
            : "Lean tender stub (no line dump).",
        materials: [],
        labour: [],
      },
    ],
    totalSell: amount,
  };
}

/** Rebuild from a previously saved summary — no BoQ line arrays required. */
export function buildJobStructureFromBoqSummary(
  job: Pick<Job, "id" | "ref" | "description">,
  summary: TenderBoqRebuildSummary,
): TenderJobStructure {
  const buckets = Array.isArray(summary.buckets) ? summary.buckets : [];
  if (!buckets.length) {
    return buildJobStructureFromTenderTotal(job, summary.totalSell || 0);
  }

  const locationNames = Array.from(new Set(buckets.map((bucket) => bucket.location || "General"))).sort(
    (a, b) => floorLabelSortKey(a) - floorLabelSortKey(b) || a.localeCompare(b),
  );
  const sections: TenderJobSection[] = locationNames.map((name) => ({
    id: `${job.id}-section-${slug(name)}`,
    name,
    description: "From won tender BoQ (lean · sheet totals only)",
  }));
  const sectionIdByName = new Map(sections.map((section) => [section.name, section.id]));

  const costCentres: TenderJobCostCentre[] = [...buckets]
    .sort((a, b) => {
      const floor = floorLabelSortKey(a.location) - floorLabelSortKey(b.location);
      if (floor !== 0) return floor;
      return a.service.localeCompare(b.service) || a.location.localeCompare(b.location);
    })
    .map((bucket) => {
      const location = bucket.location || "General";
      const service = bucket.service || "General";
      const sectionId = sectionIdByName.get(location) || sections[0]!.id;
      const sell = roundMoney(bucket.sell || 0);
      return {
        id: `${job.id}-cc-${slug(location)}-${slug(service)}`,
        name: service,
        sectionId,
        templateName: service,
        clientDescription: `${location} · ${service}`,
        engineerDescription: `Lean sheet total £${sell.toFixed(2)} (${bucket.lineCount || 0} priced line(s) · no line dump).`,
        materials: [],
        labour: [],
      };
    });

  const totalSell =
    roundMoney(summary.totalSell) ||
    roundMoney(buckets.reduce((sum, bucket) => sum + (bucket.sell || 0), 0));

  return { sections, costCentres, totalSell };
}

/** Pure builder — floors as sections, services as cost centres; always one package line per centre (no BoQ line dump). */
export function buildJobStructureFromTenderBoq(
  job: Pick<Job, "id" | "ref" | "description">,
  lines: TenderBoqLine[],
): TenderJobStructure {
  return buildJobStructureFromBoqSummary(job, summariseTenderBoqForRebuild(lines));
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

/** Persist a pre-built lean structure onto a job; keeps daywork centres; syncs job.value. */
export function applyBuiltTenderStructureToJob(
  job: Job,
  built: TenderJobStructure,
  options?: { replace?: boolean },
): TenderJobStructure & { job: Job } {
  const leanCentres = leanCentresForTransport(job.id, built.costCentres) as TenderJobCostCentre[];
  const structure: TenderJobStructure = {
    sections: sanitizeJobSections(built.sections, job.id),
    costCentres: sanitizeJobCostCentres(leanCentres, job.id),
    totalSell: built.totalSell,
  };

  const replace = options?.replace !== false;
  if (!replace) {
    const hub = getHubDetailState();
    const existingCentres = Array.isArray(asMap(hub.jobCostCentres)[job.id])
      ? (asMap(hub.jobCostCentres)[job.id] as Array<Record<string, unknown>>)
      : [];
    if (existingCentres.length) {
      return { ...structure, job };
    }
  }

  // sideStoreOnly: never stringify hub-detail-store during rebuild (OOM path).
  writeJobCostCentresAndSections(job.id, structure.costCentres, structure.sections, {
    skipRehydrate: true,
    sideStoreOnly: true,
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

/** Persist BoQ-built structure onto a job; keeps daywork centres; syncs job.value to BoQ total. */
export function applyTenderBoqStructureToJob(
  job: Job,
  lines: TenderBoqLine[],
  options?: { replace?: boolean },
): TenderJobStructure & { job: Job } {
  return applyBuiltTenderStructureToJob(job, buildJobStructureFromTenderBoq(job, lines), options);
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
  const leanNonDaywork = sanitizeJobCostCentres(leanCentresForTransport(jobId, result.centres), jobId);
  const leanDaywork = sanitizeJobCostCentres(dayworkKept, jobId);
  const nextCentres = [...leanNonDaywork, ...leanDaywork];
  // Avoid JSON.stringify on huge dumps — that alone OOM'd Render when opening bad jobs.
  const needsPersist =
    result.healed ||
    existingList.length !== nextCentres.length ||
    existingList.some((centre) => !Array.isArray(centre.materials) || !Array.isArray(centre.labour)) ||
    existingList.some((centre) => Array.isArray(centre.materials) && centre.materials.length > MAX_TENDER_BOQ_MATERIALS_PER_CENTRE);
  if (!needsPersist) {
    return {
      healed: false,
      centres: nextCentres.length ? nextCentres : sanitizeJobCostCentres(existingList, jobId),
      sections,
    };
  }

  // Persist lean centres only — side store; never stringify the full hub on heal.
  writeJobCostCentresAndSections(jobId, nextCentres, sections, {
    preserveDaywork: false,
    skipRehydrate: true,
    sideStoreOnly: true,
  });

  return {
    healed: true,
    reason: result.reason || "sanitized cost centre shape",
    centres: nextCentres,
    sections,
  };
}
