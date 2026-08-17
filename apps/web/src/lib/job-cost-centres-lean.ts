/**
 * Nuclear lean cost centres — never hydrate BoQ line dumps into materials[].
 * Rebuild / heal / job-open strip to empty materials; sheet totals live in notes + job.value.
 */

export const LEAN_MAX_MATERIALS_PER_CENTRE = 40;
/** Tender-sourced centres never keep line dumps (0 materials). */
export const LEAN_MAX_TENDER_MATERIALS_PER_CENTRE = 0;
export const LEAN_MAX_MATERIALS_PER_JOB = 200;
/** Heuristic: > this many material rows across a job is treated as a fat dump. */
export const LEAN_FAT_MATERIALS_HEURISTIC = 50;
/** Rough char budget before we treat a centre list as fat without full stringify. */
export const LEAN_FAT_JSON_CHARS_HEURISTIC = 80_000;

export const LEAN_REBUILD_NOTICE = "Rebuilt lean centres (no line dump)";

export type LeanMaterialLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
};

export type BoqSheetTotal = {
  sheet: string;
  sell: number;
  lineCount: number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function materialSell(line: {
  quantity?: unknown;
  unitCost?: unknown;
  markupPercent?: unknown;
}) {
  const qty = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 0;
  const unit = typeof line.unitCost === "number" && Number.isFinite(line.unitCost) ? line.unitCost : 0;
  const markup =
    typeof line.markupPercent === "number" && Number.isFinite(line.markupPercent) ? line.markupPercent : 0;
  return roundMoney(qty * unit * (1 + markup / 100));
}

export function isBoqDumpCatalogItemId(catalogItemId?: string | null) {
  return catalogItemId === "tender-boq";
}

export function isUserAuthoredMaterialLine(line: { catalogItemId?: string } | null | undefined) {
  return Boolean(line) && !isBoqDumpCatalogItemId(line?.catalogItemId);
}

function dumpMaterialCount(materials: unknown): number {
  if (!Array.isArray(materials)) return 0;
  return materials.filter((row) => row && typeof row === "object" && isBoqDumpCatalogItemId((row as { catalogItemId?: string }).catalogItemId)).length;
}

function userAuthoredMaterials<T extends { catalogItemId?: string }>(materials: T[]): T[] {
  return materials.filter((line) => isUserAuthoredMaterialLine(line));
}

/** True when this centre is (or was) a tender BoQ package dump. */
export function isTenderBoqCostCentre(centre: {
  materials?: Array<{ catalogItemId?: string }> | null;
  engineerDescription?: string | null;
  templateName?: string | null;
}): boolean {
  const materials = Array.isArray(centre.materials) ? centre.materials : [];
  // Kit / catalogue / one-off lines must stay itemised — do not treat the centre as a lump.
  if (materials.some((line) => isUserAuthoredMaterialLine(line))) return false;
  if (materials.some((line) => isBoqDumpCatalogItemId(line?.catalogItemId))) return true;
  const note = `${centre.engineerDescription || ""} ${centre.templateName || ""}`;
  return /tender\s*boq|from tender|lean (package|sheet|centres)|collapsed .* lines|no line dump/i.test(note);
}

function sumMaterialsSell(materials: Array<Record<string, unknown>>): number {
  let sell = 0;
  for (const row of materials) {
    if (!row || typeof row !== "object") continue;
    sell = roundMoney(sell + materialSell(row));
  }
  return sell;
}

/**
 * One-pass sheet totals from BoQ lines — discards line bodies immediately.
 * Only retains { sheet, sell, lineCount }. Never builds materials from lines.
 */
export function aggregateBoqSheetTotals(
  lines: Iterable<{
    kind?: string;
    sheet?: string | null;
    rate?: number | null;
    value?: number | null;
    quantity?: number | null;
  }>,
): { sheets: BoqSheetTotal[]; totalSell: number } {
  const map = new Map<string, BoqSheetTotal>();
  let totalSell = 0;
  for (const line of lines) {
    if (!line || line.kind !== "measured") continue;
    const hasRate = typeof line.rate === "number" && Number.isFinite(line.rate);
    const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
    if (!hasRate && !hasValue) continue;
    const amount = hasValue
      ? roundMoney(line.value as number)
      : roundMoney(
          (line.rate as number) *
            (typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 1),
        );
    const sheet = (line.sheet || "").trim() || "General";
    const key = sheet.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.sell = roundMoney(existing.sell + amount);
      existing.lineCount += 1;
    } else {
      map.set(key, { sheet, sell: amount, lineCount: 1 });
    }
    totalSell = roundMoney(totalSell + amount);
  }
  return { sheets: Array.from(map.values()), totalSell };
}

/** Count materials / rough size without JSON.stringify of the whole dump. */
export function jobCentresLookFat(centres: unknown): boolean {
  if (!Array.isArray(centres)) return false;
  let materials = 0;
  let approxChars = 0;
  for (const raw of centres) {
    if (!raw || typeof raw !== "object") continue;
    const centre = raw as Record<string, unknown>;
    const mats = Array.isArray(centre.materials) ? centre.materials : [];
    materials += dumpMaterialCount(mats);
    if (materials > LEAN_FAT_MATERIALS_HEURISTIC) return true;
    approxChars += String(centre.name || "").length + String(centre.engineerDescription || "").length;
    for (let i = 0; i < Math.min(mats.length, 8); i += 1) {
      const row = mats[i];
      if (!row || typeof row !== "object") continue;
      const line = row as Record<string, unknown>;
      approxChars += String(line.description || "").length + 48;
    }
    if (mats.length > 8) approxChars += (mats.length - 8) * 64;
    if (approxChars > LEAN_FAT_JSON_CHARS_HEURISTIC) return true;
  }
  return materials > LEAN_FAT_MATERIALS_HEURISTIC;
}

/**
 * Nuclear strip: empty materials[] on every centre (stream-sum sell into engineer note).
 * Used for tender-linked job open / rebuild / transport — never keeps BoQ lines.
 */
export function stripCentresToEmptyMaterials(
  jobId: string,
  centres: unknown,
  options?: { forceAll?: boolean; reason?: string },
): { centres: Array<Record<string, unknown>>; changed: boolean; strippedMaterials: number } {
  if (!Array.isArray(centres)) {
    return { centres: [], changed: centres != null, strippedMaterials: 0 };
  }
  const forceAll = options?.forceAll === true;
  const reason = options?.reason || "lean centres (no line dump)";
  let changed = false;
  let strippedMaterials = 0;
  const next = centres.map((raw, index) => {
    if (!raw || typeof raw !== "object") return raw as Record<string, unknown>;
    const centre = { ...(raw as Record<string, unknown>) };
    const materialsRaw = Array.isArray(centre.materials) ? (centre.materials as Array<Record<string, unknown>>) : [];
    const labourRaw = Array.isArray(centre.labour) ? centre.labour : [];
    centre.labour = labourRaw;
    centre.clientDescription = String(centre.clientDescription ?? "");
    centre.engineerDescription = String(centre.engineerDescription ?? "");

    const dumpLines = materialsRaw.filter((row) => isBoqDumpCatalogItemId(typeof row.catalogItemId === "string" ? row.catalogItemId : undefined));
    const keptLines = forceAll ? [] : userAuthoredMaterials(materialsRaw as Array<{ catalogItemId?: string }>);
    const looksTender =
      forceAll ||
      isTenderBoqCostCentre({
        materials: materialsRaw as Array<{ catalogItemId?: string }>,
        engineerDescription: String(centre.engineerDescription || ""),
        templateName: typeof centre.templateName === "string" ? centre.templateName : null,
      });

    if (!looksTender && dumpLines.length === 0) {
      if (!Array.isArray(centre.materials)) {
        centre.materials = [];
        changed = true;
      }
      return centre;
    }

    if (dumpLines.length === 0 && keptLines.length === materialsRaw.length && Array.isArray(centre.materials)) {
      return centre;
    }

    const sell = sumMaterialsSell(dumpLines.length ? dumpLines : materialsRaw);
    const id = typeof centre.id === "string" && centre.id ? centre.id : `cc-${index}`;
    strippedMaterials += dumpLines.length || (forceAll ? materialsRaw.length : 0);
    centre.materials = keptLines;
    if ((sell > 0 || dumpLines.length > 0) && keptLines.length === 0) {
      centre.engineerDescription = `${centre.engineerDescription || "From tender BoQ"} · sheet total £${sell.toFixed(2)} (${(dumpLines.length || materialsRaw.length) || 0} lines stripped · ${reason})`.slice(
        0,
        480,
      );
    }
    if (!centre.id) centre.id = id;
    if (keptLines.length !== materialsRaw.length || forceAll) changed = true;
    return centre;
  });

  return {
    centres: next.filter(Boolean) as Array<Record<string, unknown>>,
    changed,
    strippedMaterials,
  };
}

/**
 * Drop oversized / tender dumps. Tender centres → empty materials[]; daywork kept unless fat.
 * Safe to call on hub read before JSON.stringify / React hydrate.
 */
export function leanJobCostCentresList(
  jobId: string,
  centres: unknown,
  options?: { maxPerCentre?: number; maxPerJob?: number; forceTenderLump?: boolean; emptyMaterials?: boolean },
): { centres: Array<Record<string, unknown>>; changed: boolean } {
  if (!Array.isArray(centres)) return { centres: [], changed: Array.isArray(centres) === false && centres != null };
  const emptyMaterials = options?.emptyMaterials === true || options?.forceTenderLump === true;
  const fat = jobCentresLookFat(centres);

  if (emptyMaterials) {
    const stripped = stripCentresToEmptyMaterials(jobId, centres, {
      forceAll: true,
      reason: "no line dump",
    });
    return { centres: stripped.centres, changed: stripped.changed };
  }

  if (fat) {
    const stripped = stripCentresToEmptyMaterials(jobId, centres, {
      forceAll: false,
      reason: "fat dump collapsed",
    });
    return { centres: stripped.centres, changed: stripped.changed };
  }

  // Strip tender BoQ dumps only — leave ordinary / daywork materials alone.
  const tenderStripped = stripCentresToEmptyMaterials(jobId, centres, {
    forceAll: false,
    reason: "no line dump",
  });
  return { centres: tenderStripped.centres, changed: tenderStripped.changed };
}

/** Lean every job's centres in a hub map. Returns whether anything changed. */
export function leanJobCostCentresMap(jobCostCentres: unknown): boolean {
  if (!jobCostCentres || typeof jobCostCentres !== "object" || Array.isArray(jobCostCentres)) return false;
  const map = jobCostCentres as Record<string, unknown>;
  let changed = false;
  for (const jobId of Object.keys(map)) {
    const result = leanJobCostCentresList(jobId, map[jobId], { emptyMaterials: false });
    if (result.changed) {
      map[jobId] = result.centres;
      changed = true;
    }
  }
  return changed;
}

/** API / rebuild transport: name + section only — materials always []. */
export function leanCentresForTransport(jobId: string, centres: unknown): Array<Record<string, unknown>> {
  const stripped = stripCentresToEmptyMaterials(jobId, centres, {
    forceAll: true,
    reason: "no line dump",
  });
  return stripped.centres.map((centre) => ({
    id: centre.id,
    name: centre.name,
    sectionId: centre.sectionId,
    templateName: centre.templateName,
    clientDescription: centre.clientDescription || "",
    engineerDescription: centre.engineerDescription || "Lean tender sheet (no line dump)",
    materials: [],
    labour: Array.isArray(centre.labour) ? centre.labour : [],
  }));
}

export { roundMoney as leanRoundMoney, materialSell as leanMaterialSell };
