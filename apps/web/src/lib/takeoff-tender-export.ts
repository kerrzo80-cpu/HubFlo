/**
 * Takeoff → Core tender BoQ export.
 * One workbook sheet per Draw-as service layer (Hot & cold, Heating, Gas, …);
 * re-push replaces the prior Takeoff block only.
 */

import { STUDIO_SERVICE_LAYERS, type StudioState } from "@/lib/takeoff-studio";
import { summariseStudioBoq, type StudioBoqRow } from "@/lib/takeoff-studio-pipe";
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

type LayeredRateLine = TakeoffRateLine & { layerId: string; layerLabel: string };

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

/**
 * Build tender BoQ lines from Studio markups, split into one sheet per Draw-as layer.
 * Within each sheet: layer header, then Pipework / Fittings / Counts / … section headers.
 */
export function buildTakeoffTenderBoqLines(
  studio: StudioState,
  options?: { library?: TakeoffRateLibrary | null; projectRef?: string },
): TenderBoqLine[] {
  const master = summariseStudioBoq(studio, "all");
  const layers = groupRowsByLayer(master);
  if (!layers.length) return [];

  const out: TenderBoqLine[] = [];
  const projectTag = options?.projectRef ? ` · ${options.projectRef}` : "";

  for (const layer of layers) {
    const sheet = takeoffBoqSheetName(layer.layerLabel);
    const seed: LayeredRateLine[] = layer.rows.map((row) => ({
      id: row.id,
      section: row.section,
      description: `Takeoff · ${row.description}`,
      quantity: row.quantity,
      unit: row.unit,
      unitCost: 0,
      markupPercent: 0,
      supplierRequired: false,
      layerId: layer.layerId,
      layerLabel: layer.layerLabel,
    }));
    const priced = priceAndExpandTakeoffMaterials(seed, options?.library) as LayeredRateLine[];

    out.push({
      id: `takeoff-boq-header-${layer.layerId}`,
      kind: "header",
      description: `${layer.layerLabel}${projectTag}`,
      sheet,
      section: layer.layerLabel,
    });

    for (const section of SECTION_ORDER) {
      const sectionLines = priced.filter((line) => line.section === section && line.quantity > 0);
      if (!sectionLines.length) continue;

      out.push({
        id: `takeoff-boq-sec-${layer.layerId}-${slugId(section)}`,
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
        out.push({
          id: `takeoff-boq-${layer.layerId}-${slugId(line.id)}`,
          kind: "measured",
          ref: sectionRef(section),
          description: line.description.replace(/^Takeoff ·\s*/i, ""),
          quantity,
          unit: line.unit || "nr",
          rate: rate > 0 ? rate : null,
          value: rate > 0 ? value : null,
          note: line.pricingNote || undefined,
          pricingSource: line.unitCost > 0 ? "rate-library" : undefined,
          sheet,
          section,
        });
      }
    }
  }

  return out;
}
