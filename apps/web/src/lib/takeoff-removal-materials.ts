import type {
  TakeoffMaterialAllowance,
  TakeoffSupplierRequestItem,
} from "@/lib/takeoff-data";

export type RemovalMaterialLine = {
  description: string;
  quantity: number;
  unit: string;
};

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

export function isRemovalCostCentre(centre: { name: string; jobDescription?: string }) {
  const name = centre.name.trim().toLowerCase();
  const description = (centre.jobDescription || "").trim().toLowerCase();
  const text = `${name} ${description}`;
  if (/removal|strip[\s-]?out|rip[\s-]?out|remove existing|decommission|take[\s-]?out/.test(name)) {
    return true;
  }
  if (/strip[\s-]?out|rip[\s-]?out|remove existing|decommission/.test(description)
    && !/\binstall\b|\brenew\b|\breplace with\b|\bnew pipe/.test(description)) {
    return true;
  }
  return /pipework removal|strip out works/.test(text);
}

/** Install metreage / jointing kit that must not land under a removal / strip-out section. */
export function isInstallMaterialOnRemoval(item: {
  description: string;
  quantity: number;
  unit: string;
}) {
  const description = item.description.trim().toLowerCase();
  const unit = item.unit.trim().toLowerCase();
  if (/\b(stop\s*ends?|caps?|waste\s*sacks?|rubble|ptfe|drain[\s-]?cock|drain[\s-]?off|temporary isolation)\b/.test(description)) {
    return false;
  }
  if (/\b(copper\s+tube|hep2o|plastic\s+pipe|pipework)\b/.test(description)
    && (unit === "m" || /^m\b/.test(unit) || item.quantity >= 8)) {
    return true;
  }
  if (/\b(elbow|tee|coupling|reducing|pipe\s+clips?|pipe\s+supports?|inhibitor|system\s+cleaner|flush chemical|solder|flux)\b/.test(description)) {
    return true;
  }
  if (/provisional\s*(—|-)?\s*confirm from markup/.test(description)) {
    return true;
  }
  return false;
}

/** Practical materials for strip-out / removal — isolation and disposal, not new pipe metreage. */
export function itemisedMaterialsForRemoval(): RemovalMaterialLine[] {
  return [
    { description: "15mm stop ends / caps", quantity: 8, unit: "nr" },
    { description: "22mm stop ends / caps", quantity: 4, unit: "nr" },
    { description: "15mm isolation / service valve (temporary isolation)", quantity: 4, unit: "nr" },
    { description: "Drain cock / drain-off point", quantity: 2, unit: "nr" },
    { description: "PTFE tape", quantity: 2, unit: "nr" },
    { description: "Heavy-duty rubble / waste sacks", quantity: 10, unit: "nr" },
  ];
}

/** Fix BoQ lines already sitting under removal/strip-out with install pipe metreage. */
export function sanitizeRemovalSectionTakeoffMaterials(
  materials: TakeoffMaterialAllowance[],
  supplierRequests: TakeoffSupplierRequestItem[] = [],
) {
  const removalSections = new Set(
    materials
      .filter((line) => isRemovalCostCentre({ name: line.section, jobDescription: line.section }))
      .map((line) => line.section),
  );
  if (!removalSections.size) {
    return { materials, supplierRequests, changed: false };
  }

  let changed = false;
  const nextMaterials: TakeoffMaterialAllowance[] = [];
  const removedIds = new Set<string>();

  for (const section of removalSections) {
    const sectionLines = materials.filter((line) => line.section === section);
    const surveyLines = sectionLines.filter((line) => (
      line.id.startsWith("survey-mat") || line.id.startsWith("openai-survey-material")
    ));
    const otherLines = sectionLines.filter((line) => !surveyLines.includes(line));
    const hasInstallLeak = surveyLines.some((line) => isInstallMaterialOnRemoval(line));
    if (!hasInstallLeak) {
      nextMaterials.push(...sectionLines);
      continue;
    }
    changed = true;
    surveyLines.forEach((line) => removedIds.add(line.id));
    nextMaterials.push(...otherLines);
    itemisedMaterialsForRemoval().forEach((item) => {
      nextMaterials.push({
        id: makeId("survey-mat"),
        section,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitCost: 0,
        markupPercent: 30,
        supplierRequired: true,
        preferredSupplier: "",
      });
    });
  }

  const nonRemoval = materials.filter((line) => !removalSections.has(line.section));
  const materialsOut = [...nonRemoval, ...nextMaterials];
  const keptIds = new Set(materialsOut.map((line) => line.id));
  const supplierOut = supplierRequests.filter((line) => {
    if (line.linkedMaterialId && removedIds.has(line.linkedMaterialId)) return false;
    if (line.linkedMaterialId && !keptIds.has(line.linkedMaterialId)
      && (line.id.startsWith("survey-rfq") || /supplier quote request/i.test(line.notes || ""))) {
      return false;
    }
    return true;
  });

  materialsOut.forEach((line) => {
    if (!removalSections.has(line.section)) return;
    if (!(line.id.startsWith("survey-mat") || line.id.startsWith("openai-survey-material"))) return;
    if (supplierOut.some((item) => item.linkedMaterialId === line.id)) return;
    changed = true;
    supplierOut.push({
      id: makeId("survey-rfq"),
      supplier: "",
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      linkedMaterialId: line.id,
      notes: `${line.section} · supplier quote request`,
    });
  });

  return { materials: materialsOut, supplierRequests: supplierOut, changed };
}
