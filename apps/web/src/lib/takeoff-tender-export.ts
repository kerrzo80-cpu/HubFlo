/**
 * Takeoff → Core tender BoQ export.
 * When drawings sit in house-type folders (Belerno, Bell, …): one workbook tab per house,
 * with Hot & cold / Heating as sections underneath.
 * Otherwise: one tab per Draw-as service layer (legacy).
 */

import { STUDIO_SERVICE_LAYERS, type StudioState } from "@/lib/takeoff-studio";
import { takeoffHouseTypeLabel } from "@/lib/takeoff-drawing-labels";
import {
  floorLabelSortKey,
  summariseStudioBoq,
  type StudioBoqRow,
} from "@/lib/takeoff-studio-pipe";
import {
  priceAndExpandTakeoffMaterials,
  type TakeoffRateLine,
} from "@/lib/takeoff-studio-rates";
import type { TakeoffRateLibrary } from "@/lib/takeoff-rate-core";
import type { TenderBoqLine } from "@/lib/tenders-types";

/** Prefix for Takeoff-pushed workbook tabs — keeps contractor sheets distinct. */
export const TAKEOFF_BOQ_SHEET_PREFIX = "Takeoff · ";

const SECTION_ORDER = ["Pipework", "Fittings", "Counts", "Areas", "Assemblies"] as const;

export function takeoffBoqSheetName(layerLabel: string): string {
  const label = layerLabel.trim() || "General";
  if (label.startsWith(TAKEOFF_BOQ_SHEET_PREFIX)) return label;
  return `${TAKEOFF_BOQ_SHEET_PREFIX}${label}`;
}

export function isTakeoffBoqLine(line: Pick<TenderBoqLine, "id" | "sheet" | "section">): boolean {
  if (line.id.startsWith("takeoff-boq-")) return true;
  const sheet = (line.sheet || "").trim();
  if (sheet === "Takeoff" || sheet.startsWith(TAKEOFF_BOQ_SHEET_PREFIX)) return true;
  return false;
}

export function mergeTakeoffBoqLines(
  existing: TenderBoqLine[],
  nextTakeoffLines: TenderBoqLine[],
): TenderBoqLine[] {
  const kept = existing.filter((line) => !isTakeoffBoqLine(line));
  return [...kept, ...nextTakeoffLines];
}

export function previousTakeoffBoqSell(lines: TenderBoqLine[] | undefined): number {
  if (!lines?.length) return 0;
  return (
    Math.round(
      lines
        .filter((line) => isTakeoffBoqLine(line) && line.kind === "measured")
        .reduce((sum, line) => {
          const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
          if (hasValue) return sum + line.value!;
          const qty = typeof line.quantity === "number" ? line.quantity : 0;
          const rate = typeof line.rate === "number" ? line.rate : 0;
          return sum + qty * rate;
        }, 0) * 100,
    ) / 100
  );
}

function layerOrderIndex(layerId: string): number {
  const idx = STUDIO_SERVICE_LAYERS.findIndex((row) => row.id === layerId);
  return idx >= 0 ? idx : 1000;
}

function slugId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "line";
}

function lineSell(unitCost: number, markupPercent: number): number {
  return Math.round(unitCost * (1 + Math.max(0, markupPercent) / 100) * 100) / 100;
}

function sectionRef(section: string): string {
  const key = section.toLowerCase();
  if (key === "pipework") return "PIPE";
  if (key === "fittings") return "FIT";
  if (key === "counts") return "CNT";
  if (key === "areas") return "AREA";
  if (key === "assemblies") return "ASM";
  return "TO";
}

function moneyLabel(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value);
}

type LayeredRateLine = TakeoffRateLine & {
  layerId: string;
  layerLabel: string;
  setLabel?: string;
  floorLabel?: string;
  sourceId: string;
};

function groupRowsByLayer(rows: StudioBoqRow[]): Array<{ layerId: string; layerLabel: string; rows: StudioBoqRow[] }> {
  const map = new Map<string, { layerId: string; layerLabel: string; rows: StudioBoqRow[] }>();
  for (const row of rows) {
    if (!(row.quantity > 0) || row.unit === "run") continue;
    const current = map.get(row.layerId);
    if (current) {
      current.rows.push(row);
      continue;
    }
    map.set(row.layerId, {
      layerId: row.layerId,
      layerLabel: row.layerLabel || row.layerId,
      rows: [row],
    });
  }
  return [...map.values()].sort((a, b) => {
    const order = layerOrderIndex(a.layerId) - layerOrderIndex(b.layerId);
    if (order !== 0) return order;
    return a.layerLabel.localeCompare(b.layerLabel);
  });
}

function groupRowsByHouseType(
  rows: StudioBoqRow[],
): Array<{ setLabel: string; rows: StudioBoqRow[] }> {
  const map = new Map<string, { setLabel: string; rows: StudioBoqRow[] }>();
  for (const row of rows) {
    if (!(row.quantity > 0) || row.unit === "run") continue;
    const setLabel = row.setLabel?.trim() || "Unassigned";
    const current = map.get(setLabel);
    if (current) {
      current.rows.push(row);
      continue;
    }
    map.set(setLabel, { setLabel, rows: [row] });
  }
  return [...map.values()].sort((a, b) => {
    if (a.setLabel === "Unassigned") return 1;
    if (b.setLabel === "Unassigned") return -1;
    return a.setLabel.localeCompare(b.setLabel);
  });
}

function floorsInLayer(rows: StudioBoqRow[]): string[] {
  const floors = new Set<string>();
  for (const row of rows) {
    if (row.floorLabel?.trim()) floors.add(row.floorLabel.trim());
  }
  return [...floors].sort((a, b) => floorLabelSortKey(a) - floorLabelSortKey(b) || a.localeCompare(b));
}

function appendPricedLayerToSheet(
  out: TenderBoqLine[],
  layer: { layerId: string; layerLabel: string; rows: StudioBoqRow[] },
  sheet: string,
  library: TakeoffRateLibrary | null | undefined,
  idPrefix: string,
  options?: { includeLayerHeader?: boolean },
) {
  const seed: LayeredRateLine[] = layer.rows.map((row) => ({
    id: row.id,
    sourceId: row.id,
    section: row.section,
    description: `Takeoff · ${row.description}`,
    quantity: row.quantity,
    unit: row.unit,
    unitCost: 0,
    markupPercent: 0,
    supplierRequired: false,
    layerId: row.layerId,
    layerLabel: row.layerLabel,
    setLabel: row.setLabel,
    floorLabel: row.floorLabel,
  }));
  const priced = priceAndExpandTakeoffMaterials(seed, library) as LayeredRateLine[];
  for (const line of priced) {
    if (line.floorLabel) continue;
    const source = seed.find((row) => row.id === line.id || line.id.startsWith(`${row.id}-`));
    if (source?.floorLabel) line.floorLabel = source.floorLabel;
  }

  if (options?.includeLayerHeader !== false) {
    out.push({
      id: `takeoff-boq-header-${idPrefix}-${layer.layerId}`,
      kind: "header",
      description: layer.layerLabel,
      sheet,
      section: layer.layerLabel,
    });
  }

  const floors = floorsInLayer(layer.rows);
  const floorBlocks = floors.length ? floors : [""];

  for (const floor of floorBlocks) {
    const floorPriced = floor
      ? priced.filter((line) => (line.floorLabel || "") === floor)
      : priced;
    if (!floorPriced.length) continue;

    if (floor) {
      out.push({
        id: `takeoff-boq-floor-${idPrefix}-${layer.layerId}-${slugId(floor)}`,
        kind: "header",
        description: floor,
        sheet,
        section: floor,
      });
    }

    let floorValue = 0;
    for (const section of SECTION_ORDER) {
      const sectionLines = floorPriced.filter((line) => line.section === section && line.quantity > 0);
      if (!sectionLines.length) continue;

      out.push({
        id: `takeoff-boq-sec-${idPrefix}-${layer.layerId}-${slugId(floor || "all")}-${slugId(section)}`,
        kind: "header",
        description: section,
        sheet,
        section,
      });

      for (const line of sectionLines) {
        const unitCost = Math.round((line.unitCost || 0) * 100) / 100;
        const rate = lineSell(unitCost, line.markupPercent || 0);
        const quantity = Math.round(line.quantity * 1000) / 1000;
        const value =
          Number.isFinite(quantity) && Number.isFinite(rate)
            ? Math.round(quantity * rate * 100) / 100
            : null;
        if (typeof value === "number") floorValue += value;
        out.push({
          id: `takeoff-boq-${idPrefix}-${layer.layerId}-${slugId(floor || "all")}-${slugId(line.id)}`,
          kind: "measured",
          ref: sectionRef(section),
          description: line.description.replace(/^Takeoff ·\s*/i, ""),
          quantity,
          unit: line.unit || "nr",
          rate: rate > 0 ? rate : null,
          value: rate > 0 ? value : null,
          note: [floor || undefined, line.pricingNote || undefined].filter(Boolean).join(" · ") || undefined,
          pricingSource: line.unitCost > 0 ? "rate-library" : undefined,
          sheet,
          section,
        });
      }
    }

    if (floor && floorValue > 0) {
      out.push({
        id: `takeoff-boq-subtotal-${idPrefix}-${layer.layerId}-${slugId(floor)}`,
        kind: "note",
        description: `${floor} subtotal ${moneyLabel(floorValue)}`,
        note: moneyLabel(floorValue),
        sheet,
        section: floor,
      });
    }
  }
}

/**
 * Build tender BoQ lines from Studio markups.
 * House-type folders → one sheet per house (Belerno, Bell), layers as sections.
 * No house folders → one sheet per Draw-as layer (legacy).
 */
export function buildTakeoffTenderBoqLines(
  studio: StudioState,
  options?: {
    library?: TakeoffRateLibrary | null;
    projectRef?: string;
    /** Drawing document id → file name for floor/level grouping; notes for house type. */
    documents?: Array<{ id: string; fileName: string; notes?: string[] }>;
  },
): TenderBoqLine[] {
  const documentNames =
    options?.documents?.length ?
      Object.fromEntries(options.documents.map((doc) => [doc.id, doc.fileName]))
    : undefined;
  const documentSetLabels =
    options?.documents?.length ?
      Object.fromEntries(options.documents.map((doc) => [doc.id, takeoffHouseTypeLabel(doc.notes)]))
    : undefined;
  const namedHouses = documentSetLabels
    ? [...new Set(Object.values(documentSetLabels))].filter((name) => name && name !== "Unassigned")
    : [];
  const splitByHouse = namedHouses.length > 0;

  const master = summariseStudioBoq(studio, "all", {
    ...(documentNames ? { documentNames } : {}),
    ...(splitByHouse && documentSetLabels ? { documentSetLabels } : {}),
  });
  if (!master.length) return [];

  const out: TenderBoqLine[] = [];
  const projectTag = options?.projectRef ? ` · ${options.projectRef}` : "";

  if (splitByHouse) {
    for (const house of groupRowsByHouseType(master)) {
      const sheet = takeoffBoqSheetName(house.setLabel);
      out.push({
        id: `takeoff-boq-house-${slugId(house.setLabel)}`,
        kind: "header",
        description: `${house.setLabel}${projectTag}`,
        sheet,
        section: house.setLabel,
      });
      for (const layer of groupRowsByLayer(house.rows)) {
        appendPricedLayerToSheet(out, layer, sheet, options?.library, slugId(house.setLabel), {
          includeLayerHeader: true,
        });
      }
    }
    return out;
  }

  for (const layer of groupRowsByLayer(master)) {
    const sheet = takeoffBoqSheetName(layer.layerLabel);
    out.push({
      id: `takeoff-boq-header-${layer.layerId}`,
      kind: "header",
      description: `${layer.layerLabel}${projectTag}`,
      sheet,
      section: layer.layerLabel,
    });
    appendPricedLayerToSheet(out, layer, sheet, options?.library, layer.layerId, {
      includeLayerHeader: false,
    });
  }

  return out;
}
