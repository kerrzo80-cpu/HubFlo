/**
 * Keep job cost centres lean on 512MB Render.
 * Never hydrate / stringify / map full BoQ line dumps into materials[].
 */

export const LEAN_MAX_MATERIALS_PER_CENTRE = 40;
/** Tender-sourced centres collapse above this (normally 1 package line). */
export const LEAN_MAX_TENDER_MATERIALS_PER_CENTRE = 1;
export const LEAN_MAX_MATERIALS_PER_JOB = 200;

export type LeanMaterialLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
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

/** True when this centre is (or was) a tender BoQ package dump. */
export function isTenderBoqCostCentre(centre: {
  materials?: Array<{ catalogItemId?: string }> | null;
  engineerDescription?: string | null;
  templateName?: string | null;
}): boolean {
  const materials = Array.isArray(centre.materials) ? centre.materials : [];
  if (materials.some((line) => line?.catalogItemId === "tender-boq")) return true;
  const note = `${centre.engineerDescription || ""} ${centre.templateName || ""}`;
  return /tender\s*boq|from tender|collapsed .* lines for stability/i.test(note);
}

function lumpFromMaterials(
  jobId: string,
  centreId: string,
  centreName: string,
  materials: Array<Record<string, unknown>>,
): LeanMaterialLine {
  let sell = 0;
  for (const row of materials) {
    if (!row || typeof row !== "object") continue;
    sell = roundMoney(sell + materialSell(row));
  }
  return {
    id: `${jobId}-lean-${centreId}`,
    catalogItemId: "tender-boq",
    description: `${centreName || "Cost centre"} · tender BoQ package (${materials.length} line(s))`,
    quantity: 1,
    unitCost: sell,
    markupPercent: 0,
  };
}

/**
 * Drop oversized materials arrays in place (stream-sum → one lump).
 * Safe to call on hub read before JSON.stringify / React hydrate.
 */
export function leanJobCostCentresList(
  jobId: string,
  centres: unknown,
  options?: { maxPerCentre?: number; maxPerJob?: number; forceTenderLump?: boolean },
): { centres: Array<Record<string, unknown>>; changed: boolean } {
  if (!Array.isArray(centres)) return { centres: [], changed: Array.isArray(centres) === false && centres != null };
  const maxPerCentre = options?.maxPerCentre ?? LEAN_MAX_MATERIALS_PER_CENTRE;
  const maxPerJob = options?.maxPerJob ?? LEAN_MAX_MATERIALS_PER_JOB;
  const forceTenderLump = options?.forceTenderLump === true;

  let totalMaterials = 0;
  let needsJobCollapse = false;
  for (const raw of centres) {
    if (!raw || typeof raw !== "object") continue;
    const materials = Array.isArray((raw as { materials?: unknown }).materials)
      ? ((raw as { materials: unknown[] }).materials)
      : [];
    totalMaterials += materials.length;
    if (materials.length > maxPerCentre) needsJobCollapse = true;
  }
  if (totalMaterials > maxPerJob) needsJobCollapse = true;

  let changed = false;
  const next = centres.map((raw, index) => {
    if (!raw || typeof raw !== "object") return raw as Record<string, unknown>;
    const centre = { ...(raw as Record<string, unknown>) };
    const materialsRaw = Array.isArray(centre.materials) ? (centre.materials as Array<Record<string, unknown>>) : [];
    const labourRaw = Array.isArray(centre.labour) ? centre.labour : [];
    centre.labour = labourRaw;
    centre.clientDescription = String(centre.clientDescription ?? "");
    centre.engineerDescription = String(centre.engineerDescription ?? "");

    const looksTender =
      forceTenderLump ||
      isTenderBoqCostCentre({
        materials: materialsRaw as Array<{ catalogItemId?: string }>,
        engineerDescription: String(centre.engineerDescription || ""),
        templateName: typeof centre.templateName === "string" ? centre.templateName : null,
      });

    const centreCap = looksTender ? Math.min(maxPerCentre, 1) : maxPerCentre;
    const shouldLump =
      materialsRaw.length > centreCap || (needsJobCollapse && materialsRaw.length > centreCap);

    if (!shouldLump) {
      if (!Array.isArray(centre.materials)) {
        centre.materials = [];
        changed = true;
      }
      return centre;
    }

    const id = typeof centre.id === "string" && centre.id ? centre.id : `cc-${index}`;
    const name = String(centre.name || "Cost centre");
    const lump = lumpFromMaterials(jobId, id, name, materialsRaw);
    centre.materials = [lump];
    centre.engineerDescription = `${centre.engineerDescription || "From tender BoQ"} · lean package (${materialsRaw.length} lines collapsed).`;
    changed = true;
    return centre;
  });

  return { centres: next.filter(Boolean) as Array<Record<string, unknown>>, changed };
}

/** Lean every job's centres in a hub map. Returns whether anything changed. */
export function leanJobCostCentresMap(jobCostCentres: unknown): boolean {
  if (!jobCostCentres || typeof jobCostCentres !== "object" || Array.isArray(jobCostCentres)) return false;
  const map = jobCostCentres as Record<string, unknown>;
  let changed = false;
  for (const jobId of Object.keys(map)) {
    const result = leanJobCostCentresList(jobId, map[jobId]);
    if (result.changed) {
      map[jobId] = result.centres;
      changed = true;
    }
  }
  return changed;
}

/** API / rebuild transport: name + section + single package value only. */
export function leanCentresForTransport(jobId: string, centres: unknown): Array<Record<string, unknown>> {
  const result = leanJobCostCentresList(jobId, centres, {
    maxPerCentre: 1,
    maxPerJob: 1,
    forceTenderLump: true,
  });
  return result.centres.map((centre) => {
    const materials = Array.isArray(centre.materials) ? (centre.materials as LeanMaterialLine[]) : [];
    const sell = materials.reduce((sum, line) => sum + materialSell(line), 0);
    const labour = Array.isArray(centre.labour) ? centre.labour : [];
    return {
      id: centre.id,
      name: centre.name,
      sectionId: centre.sectionId,
      templateName: centre.templateName,
      clientDescription: centre.clientDescription || "",
      engineerDescription: centre.engineerDescription || "Lean tender BoQ package",
      materials:
        sell > 0 || materials.length
          ? [
              {
                id: `${jobId}-pkg-${String(centre.id || "cc")}`,
                catalogItemId: "tender-boq",
                description: `${String(centre.name || "Cost centre")} · tender package`,
                quantity: 1,
                unitCost: sell || (materials[0] ? materialSell(materials[0]) : 0),
                markupPercent: 0,
              },
            ]
          : [],
      labour,
    };
  });
}
