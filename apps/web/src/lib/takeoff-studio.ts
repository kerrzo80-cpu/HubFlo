/** NeXa Takeoff Studio — Togal-style classification + geometry model (NeXa / EWG, not a clone of Togal). */

export type StudioClassKind = "area" | "linear" | "count";

export type StudioTool =
  | "pan"
  | "select"
  | "count"
  | "linear"
  | "area"
  | "rect"
  | "scale"
  | "measure";

export type StudioPoint = { x: number; y: number };

export type StudioClassification = {
  id: string;
  kind: StudioClassKind;
  name: string;
  colour: string;
  unit: "m2" | "m" | "nr";
  notes?: string;
};

export type StudioGeometry =
  | {
      id: string;
      classificationId: string;
      kind: "count";
      documentId: string;
      page: number;
      point: StudioPoint;
    }
  | {
      id: string;
      classificationId: string;
      kind: "linear";
      documentId: string;
      page: number;
      points: StudioPoint[];
      closed?: boolean;
    }
  | {
      id: string;
      classificationId: string;
      kind: "area";
      documentId: string;
      page: number;
      points: StudioPoint[];
      closed: boolean;
    };

export type StudioPageScale = {
  documentId: string;
  page: number;
  /** Metres per PDF page-unit (same space as pdf.js viewport at scale 1). */
  metresPerUnit: number;
  /** Optional two-point calibration used to derive metresPerUnit. */
  calibrateFrom?: StudioPoint;
  calibrateTo?: StudioPoint;
  knownMetres?: number;
  label?: string;
};

export type StudioState = {
  version: 1;
  activeDocumentId?: string;
  activePage: number;
  activeClassificationId?: string;
  tool: StudioTool;
  classifications: StudioClassification[];
  geometries: StudioGeometry[];
  scales: StudioPageScale[];
  updatedAt: string;
};

const COLOURS = ["#1998cf", "#2e8c7d", "#c45c26", "#7a4f9a", "#b43a3a", "#b36a16", "#14618c", "#5b6b7a"];

export function createDefaultStudioState(): StudioState {
  const stamp = new Date().toISOString();
  const classifications: StudioClassification[] = [
    { id: "cls-area-rooms", kind: "area", name: "Rooms", colour: COLOURS[0] || "#1998cf", unit: "m2" },
    { id: "cls-linear-walls", kind: "linear", name: "Walls", colour: COLOURS[1] || "#2e8c7d", unit: "m" },
    { id: "cls-count-doors", kind: "count", name: "Doors", colour: COLOURS[2] || "#c45c26", unit: "nr" },
    { id: "cls-count-plumbing", kind: "count", name: "Plumbing fixtures", colour: COLOURS[3] || "#7a4f9a", unit: "nr" },
  ];
  return {
    version: 1,
    activePage: 1,
    tool: "pan",
    activeClassificationId: classifications[3]!.id,
    classifications,
    geometries: [],
    scales: [],
    updatedAt: stamp,
  };
}

export function detectScaleRatioHints(text: string): string[] {
  const hints = new Set<string>();
  const patterns = [
    /\bSCALE\s*[:=]?\s*1\s*[:/]\s*(\d+)\b/gi,
    /\b1\s*:\s*(\d+)\b/g,
    /\b1\s*\/\s*(\d+)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const denom = Number(match[1]);
      if (denom >= 10 && denom <= 5000) hints.add(`1:${denom}`);
    }
  }
  return [...hints].slice(0, 4);
}

/**
 * Convert a printed ratio (e.g. 1:100) into metres-per-canvas-unit.
 * Assumes PDF user units are points (1/72"), then divides by the canvas render scale.
 */
export function metresPerUnitFromRatio(denom: number, renderScale = 1.35): number | null {
  if (!(denom > 0) || !(renderScale > 0)) return null;
  const metresPerPdfPoint = (1 / 72) * 0.0254 * denom;
  return metresPerPdfPoint / renderScale;
}

export function parseScaleRatioLabel(label: string): number | null {
  const match = /^1\s*[:/]\s*(\d+)$/i.exec(label.trim());
  if (!match) return null;
  const denom = Number(match[1]);
  return denom >= 10 && denom <= 5000 ? denom : null;
}

export function studioId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function nextClassificationColour(existing: StudioClassification[]) {
  return COLOURS[existing.length % COLOURS.length] || COLOURS[0] || "#1998cf";
}

export function polylineLength(points: StudioPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Shoelace area in page units². */
export function polygonArea(points: StudioPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function scaleForPage(studio: StudioState, documentId: string, page: number): StudioPageScale | undefined {
  return studio.scales.find((row) => row.documentId === documentId && row.page === page);
}

export type StudioQuantityRow = {
  classificationId: string;
  name: string;
  kind: StudioClassKind;
  colour: string;
  quantity: number;
  unit: string;
  pieces: number;
};

export function summariseStudioQuantities(studio: StudioState): StudioQuantityRow[] {
  return studio.classifications.map((cls) => {
    const items = studio.geometries.filter((geo) => geo.classificationId === cls.id);
    let quantity = 0;
    for (const geo of items) {
      const scale = scaleForPage(studio, geo.documentId, geo.page);
      const mpu = scale?.metresPerUnit || 0;
      if (geo.kind === "count") {
        quantity += 1;
      } else if (geo.kind === "linear") {
        quantity += polylineLength(geo.points) * mpu;
      } else if (geo.kind === "area" && geo.closed) {
        quantity += polygonArea(geo.points) * mpu * mpu;
      }
    }
    return {
      classificationId: cls.id,
      name: cls.name,
      kind: cls.kind,
      colour: cls.colour,
      quantity: cls.kind === "count" ? quantity : Number(quantity.toFixed(2)),
      unit: cls.unit,
      pieces: items.length,
    };
  });
}

export function studioQuantitiesToMaterialAllowances(
  studio: StudioState,
  projectId: string,
): Array<{
  id: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  markupPercent: number;
  supplierRequired: boolean;
}> {
  return summariseStudioQuantities(studio)
    .filter((row) => row.quantity > 0)
    .map((row) => ({
      id: `studio-mat-${projectId}-${row.classificationId}`,
      section: row.kind === "area" ? "Areas" : row.kind === "linear" ? "Linears" : "Counts",
      description: `Takeoff · ${row.name}`,
      quantity: row.quantity,
      unit: row.unit,
      unitCost: 0,
      markupPercent: 0,
      supplierRequired: false,
    }));
}

/** Import skill text-tag count pins onto the Studio canvas as Count classifications. */
export function importSkillCountsIntoStudio(
  studio: StudioState,
  measured: Array<{
    id: string;
    kind: "primary" | "secondary";
    code: string;
    description: string;
    unit: string;
    tagMatches?: Array<{
      id: string;
      documentId: string;
      pageNumber: number;
      x: number;
      y: number;
      pageWidth?: number;
      pageHeight?: number;
      excluded?: boolean;
    }>;
  }>,
  options?: { canvasWidth?: number; canvasHeight?: number; replaceExistingAi?: boolean },
): StudioState {
  const canvasW = options?.canvasWidth || 0;
  const canvasH = options?.canvasHeight || 0;
  const keep = options?.replaceExistingAi
    ? studio.geometries.filter((geo) => !geo.id.startsWith("ai-"))
    : studio.geometries;

  const classifications = [...studio.classifications];
  const geometries = [...keep];

  for (const row of measured) {
    if (row.kind !== "primary" || row.unit !== "nr") continue;
    const matches = (row.tagMatches || []).filter((match) => !match.excluded);
    if (!matches.length) continue;

    let cls = classifications.find((item) => item.id === `cls-ai-${row.code}`);
    if (!cls) {
      cls = {
        id: `cls-ai-${row.code}`,
        kind: "count",
        name: row.description || row.code,
        colour: nextClassificationColour(classifications),
        unit: "nr",
        notes: `Imported from Blake · ${row.code}`,
      };
      classifications.push(cls);
    }

    for (const match of matches) {
      const pageHeight = match.pageHeight || 0;
      const renderScale =
        canvasW && match.pageWidth ? canvasW / match.pageWidth : 1.35;
      // PDF text transforms are origin bottom-left; Studio canvas is top-left at render scale.
      geometries.push({
        id: `ai-${match.id}`,
        classificationId: cls.id,
        kind: "count",
        documentId: match.documentId,
        page: match.pageNumber || 1,
        point: {
          x: match.x * renderScale,
          y: pageHeight ? (pageHeight - match.y) * renderScale : match.y * renderScale,
        },
      });
    }
  }

  const firstAi = geometries.find((geo) => geo.id.startsWith("ai-"));
  const firstAiClass = classifications.find((c) => c.id.startsWith("cls-ai-"));

  return {
    ...studio,
    classifications,
    geometries,
    activeDocumentId: firstAi?.documentId || studio.activeDocumentId,
    activePage: firstAi?.page || studio.activePage,
    activeClassificationId: firstAiClass?.id || studio.activeClassificationId,
    tool: "select",
    updatedAt: new Date().toISOString(),
  };
}
