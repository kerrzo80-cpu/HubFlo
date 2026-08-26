/**
 * Takeoff → Core tender BoQ export.
 * One workbook sheet per house type; within each sheet, section headers for
 * Draw-as layers (Hot & cold, Heating, Gas, …) then floor when drawing names exist.
 * Re-push replaces the prior Takeoff block only.
 */

import { STUDIO_SERVICE_LAYERS, ensureServiceClassifications, type StudioState } from "@/lib/takeoff-studio";
import {
  houseTypeByDocumentId,
  UNGROUPED_HOUSE_TYPE,
} from "@/lib/takeoff-drawing-folders";
import {
  floorLabelSortKey,
  isUnspecifiedFloorLabel,
  summariseStudioBoq,
  type StudioBoqRow,
} from "@/lib/takeoff-studio-pipe";
import { ensurePlantClassifications } from "@/lib/takeoff-blake-propose";
import {
  priceAndExpandTakeoffMaterials,
  type TakeoffRateLine,
} from "@/lib/takeoff-studio-rates";
import type { TakeoffRateLibrary } from "@/lib/takeoff-rate-core";
import type { TenderBoqLine } from "@/lib/tenders-types";

/** Prefix for Takeoff-pushed workbook tabs — keeps contractor sheets distinct. */
export const TAKEOFF_BOQ_SHEET_PREFIX = "Takeoff · ";

const SECTION_ORDER = ["Pipework", "Fittings", "Counts", "Areas", "Assemblies"] as const;

export function takeoffBoqSheetName(houseTypeLabel: string): string {
  const label = houseTypeLabel.trim() || UNGROUPED_HOUSE_TYPE;
  const prefixed = label.startsWith(TAKEOFF_BOQ_SHEET_PREFIX) ? label : `${TAKEOFF_BOQ_SHEET_PREFIX}${label}`;
  return prefixed.slice(0, 31);
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
  floorLabel?: string;
  houseTypeLabel?: string;
  sourceId: string;
};

function groupRowsByHouseType(
  rows: StudioBoqRow[],
): Array<{ houseType: string; rows: StudioBoqRow[] }> {
  const map = new Map<string, { houseType: string; rows: StudioBoqRow[] }>();
  for (const row of rows) {
    if (!(row.quantity > 0) || row.unit === "run") continue;
    const houseType = row.houseTypeLabel?.trim() || UNGROUPED_HOUSE_TYPE;
    const current = map.get(houseType);
    if (current) {
      current.rows.push(row);
      continue;
    }
    map.set(houseType, { houseType, rows: [row] });
  }
  return [...map.values()].sort((a, b) => {
    if (a.houseType === UNGROUPED_HOUSE_TYPE && b.houseType !== UNGROUPED_HOUSE_TYPE) return 1;
    if (b.houseType === UNGROUPED_HOUSE_TYPE && a.houseType !== UNGROUPED_HOUSE_TYPE) return -1;
    return a.houseType.localeCompare(b.houseType, undefined, { numeric: true });
  });
}

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

function floorsInLayer(rows: StudioBoqRow[]): string[] {
  const floors = new Set<string>();
  for (const row of rows) {
    const floor = row.floorLabel?.trim();
    if (floor && !isUnspecifiedFloorLabel(floor)) floors.add(floor);
  }
  return [...floors].sort((a, b) => floorLabelSortKey(a) - floorLabelSortKey(b) || a.localeCompare(b));
}

/**
 * Build tender BoQ lines from Studio markups: one sheet tab per house type,
 * layer headers (Hot & cold / Heating / Gas / …) inside the tab, then floor.
 */
export function buildTakeoffTenderBoqLines(
  studio: StudioState,
  options?: {
    library?: TakeoffRateLibrary | null;
    projectRef?: string;
    /** Drawing document id → file name / notes for floor + house-type grouping. */
    documents?: Array<{ id: string; fileName: string; notes?: string[] }>;
  },
): TenderBoqLine[] {
  const prepared = ensurePlantClassifications(ensureServiceClassifications(studio));
  const documentNames =
    options?.documents?.length ?
      Object.fromEntries(options.documents.map((doc) => [doc.id, doc.fileName]))
    : undefined;
  const documentHouseTypes =
    options?.documents?.length ? houseTypeByDocumentId(options.documents) : undefined;
  const master = summariseStudioBoq(prepared, "all", {
    ...(documentNames ? { documentNames } : {}),
    ...(documentHouseTypes ? { documentHouseTypes } : {}),
  });
  const houses = groupRowsByHouseType(master);
  if (!houses.length) return [];

  const out: TenderBoqLine[] = [];
  const projectTag = options?.projectRef ? ` · ${options.projectRef}` : "";

  for (const house of houses) {
    const sheet = takeoffBoqSheetName(house.houseType);
    const houseSlug = slugId(house.houseType);
    const layers = groupRowsByLayer(house.rows);

    for (const layer of layers) {
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
        floorLabel: row.floorLabel,
        houseTypeLabel: house.houseType,
      }));
      const priced = priceAndExpandTakeoffMaterials(seed, options?.library) as LayeredRateLine[];
      for (const line of priced) {
        if (line.floorLabel) continue;
        const source = seed.find((row) => row.id === line.id || line.id.startsWith(`${row.id}-`));
        if (source?.floorLabel) line.floorLabel = source.floorLabel;
      }

      out.push({
        id: `takeoff-boq-header-${houseSlug}-${layer.layerId}`,
        kind: "header",
        description: `${layer.layerLabel}${projectTag}`,
        sheet,
        section: layer.layerLabel,
      });

      const floors = floorsInLayer(layer.rows);
      const floorBlocks = floors.length ? floors : [""];

      for (const floor of floorBlocks) {
        const floorPriced = floor
          ? priced.filter((line) => (line.floorLabel || "") === floor)
          : priced;
        if (!floorPriced.length) continue;

        if (floor) {
          out.push({
            id: `takeoff-boq-floor-${houseSlug}-${layer.layerId}-${slugId(floor)}`,
            kind: "note",
            description: floor,
            sheet,
            section: layer.layerLabel,
          });
        }

        let floorValue = 0;
        const emitted = new Set<string>();
        const emitMeasured = (line: LayeredRateLine) => {
          if (!(line.quantity > 0) || emitted.has(line.id)) return;
          emitted.add(line.id);
          const unitCost = Math.round((line.unitCost || 0) * 100) / 100;
          const rate = lineSell(unitCost, line.markupPercent || 0);
          const quantity = Math.round(line.quantity * 1000) / 1000;
          const value =
            Number.isFinite(quantity) && Number.isFinite(rate)
              ? Math.round(quantity * rate * 100) / 100
              : null;
          if (typeof value === "number") floorValue += value;
          out.push({
            id: `takeoff-boq-${houseSlug}-${layer.layerId}-${slugId(floor || "all")}-${slugId(line.id)}`,
            kind: "measured",
            ref: sectionRef(line.section),
            description: line.description.replace(/^Takeoff ·\s*/i, ""),
            quantity,
            unit: line.unit || "nr",
            rate: rate > 0 ? rate : null,
            value: rate > 0 ? value : null,
            note: [floor || undefined, line.pricingNote || undefined].filter(Boolean).join(" · ") || undefined,
            pricingSource: line.unitCost > 0 ? "rate-library" : undefined,
            sheet,
            section: layer.layerLabel,
          });
        };

        for (const section of SECTION_ORDER) {
          for (const line of floorPriced) {
            if (line.section === section) emitMeasured(line);
          }
        }
        for (const line of floorPriced) emitMeasured(line);

        if (floor && floorValue > 0) {
          out.push({
            id: `takeoff-boq-subtotal-${houseSlug}-${layer.layerId}-${slugId(floor)}`,
            kind: "note",
            description: `${floor} subtotal ${moneyLabel(floorValue)}`,
            note: moneyLabel(floorValue),
            sheet,
            section: layer.layerLabel,
          });
        }
      }
    }
  }

  return out;
}
