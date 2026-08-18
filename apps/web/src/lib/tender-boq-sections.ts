/**
 * Pure BoQ section / selection helpers — safe for client bundles.
 */

import { type TenderBoqLine } from "@/lib/tenders-types";

export type BoqSectionGroup = {
  /** Stable key for UI selection (empty string = ungrouped top of bill). */
  key: string;
  /** Display label (sheet / section title). */
  label: string;
  headerId?: string;
  measuredIds: string[];
};

export type BoqSheetTab = {
  /** Worksheet name key. */
  key: string;
  label: string;
  measuredIds: string[];
};

export function isBoqLinePriced(line: TenderBoqLine): boolean {
  const hasRate = typeof line.rate === "number" && Number.isFinite(line.rate);
  const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
  return hasRate || hasValue;
}

/** Takeoff Hot & cold style metres — must never land on a Filpumps/sales-order tab. */
export function looksLikeTakeoffPipeMetreLine(ref: string, description: string): boolean {
  const hay = `${ref || ""} ${description || ""}`.toLowerCase();
  if (!hay.trim()) return false;
  if (/\bcold\s+pipe\s+runs?\b/.test(hay)) return true;
  if (/\bhot\s+pipe\s+runs?\b/.test(hay)) return true;
  if (/^\s*pipe\s*$/i.test(ref || "") && /\b\d{2}\s*mm\b/.test(hay) && /\bcopper\b/.test(hay)) {
    return true;
  }
  return false;
}

/** Sheet tabs named like supplier sales orders / quotations / flat heating packs. */
export function looksLikeSupplierQuoteSheetName(sheet: string): boolean {
  const key = (sheet || "").toLowerCase();
  return (
    /\bsales\s*order\b/.test(key) ||
    /\bquotation\b/.test(key) ||
    /\bfilpumps\b/.test(key) ||
    /\bquote\b/.test(key) ||
    /\bwilliam\s*wilson\b/.test(key) ||
    /\bheating\b/.test(key)
  );
}

const BOQ_LAYER_SECTION_ALIASES: Array<{ label: string; match: RegExp }> = [
  { label: "Hot & cold", match: /^(?:takeoff\s*·\s*)?(?:hot\s*(?:&|and)\s*cold|h\s*&\s*c|h&c)$/i },
  { label: "Heating", match: /^(?:takeoff\s*·\s*)?heating$/i },
  { label: "Gas", match: /^(?:takeoff\s*·\s*)?gas$/i },
  { label: "Sanitary & waste", match: /^(?:takeoff\s*·\s*)?(?:sanitary(?:\s*&\s*waste)?|waste)$/i },
  { label: "Waste", match: /^(?:takeoff\s*·\s*)?waste$/i },
  { label: "General", match: /^(?:takeoff\s*·\s*)?general$/i },
];

/** Layer name when a sheet tab is itself a service (Heating, Takeoff · Gas, …). */
export function layerSectionFromSheetName(sheet: string | null | undefined): string | null {
  const raw = (sheet || "").trim();
  if (!raw) return null;
  for (const row of BOQ_LAYER_SECTION_ALIASES) {
    if (row.match.test(raw)) return row.label;
  }
  return null;
}

/**
 * Resolve the sheet/section label for a line index — prefers stored `section`,
 * otherwise the nearest preceding header row.
 */
export function resolveBoqLineSection(lines: TenderBoqLine[], index: number): string {
  const line = lines[index];
  if (!line) return "";
  if (line.section?.trim()) return line.section.trim();
  if (line.kind === "header") return (line.description || "").trim();
  for (let i = index - 1; i >= 0; i -= 1) {
    const prior = lines[i];
    if (prior?.kind === "header") return (prior.section || prior.description || "").trim();
    if (prior?.section?.trim()) return prior.section.trim();
  }
  return "";
}

/** Excel workbook-style tabs from stamped `sheet` values (import order preserved). */
export function listBoqSheetTabs(lines: TenderBoqLine[]): BoqSheetTab[] {
  const tabs: BoqSheetTab[] = [];
  const byKey = new Map<string, BoqSheetTab>();
  for (const line of lines) {
    const key = line.sheet?.trim();
    if (!key) continue;
    let tab = byKey.get(key);
    if (!tab) {
      tab = { key, label: key, measuredIds: [] };
      byKey.set(key, tab);
      tabs.push(tab);
    }
    if (line.kind === "measured") tab.measuredIds.push(line.id);
  }
  return tabs;
}

/** Lines belonging to one workbook sheet tab (or all lines when no sheet filter). */
export function filterBoqLinesBySheet(lines: TenderBoqLine[], sheetKey: string | null): TenderBoqLine[] {
  if (!sheetKey) return lines;
  return lines.filter((line) => (line.sheet || "").trim() === sheetKey);
}

/**
 * True when this header only echoes the workbook sheet name (redundant under sheet tabs).
 */
export function isBoqSheetEchoHeader(line: TenderBoqLine): boolean {
  if (line.kind !== "header") return false;
  const sheet = (line.sheet || "").trim();
  if (!sheet) return false;
  const label = (line.section || line.description || "").trim();
  return label === sheet;
}

const INTERNAL_BOQ_SUBHEADER_LABELS = new Set([
  "pipework",
  "fittings",
  "counts",
  "areas",
  "assemblies",
  "unspecified",
  "unspecified floor",
]);

/** Inner takeoff headings (Pipework / floor / Unspecified) sit under a service layer, not beside it. */
export function isBoqLayerSubHeader(line: Pick<TenderBoqLine, "kind" | "section" | "description">): boolean {
  if (line.kind !== "header") return false;
  const label = (line.section || line.description || "").trim();
  if (!label) return false;
  const key = label.toLowerCase();
  if (INTERNAL_BOQ_SUBHEADER_LABELS.has(key)) return true;
  if (/^(lower\s*ground|ground|first|second|third|fourth|basement)$/i.test(label)) return true;
  if (/^flat\s+\S+/i.test(label)) return true;
  return false;
}

/** Group BoQ lines into sheet/section blocks for select-all and header display. */
export function groupBoqLinesBySection(lines: TenderBoqLine[]): BoqSectionGroup[] {
  const groups: BoqSectionGroup[] = [];
  let current: BoqSectionGroup | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.kind === "header") {
      if (isBoqLayerSubHeader(line) && current) continue;
      const label = (line.section || line.description || "").trim();
      current = {
        key: line.id,
        label: label || "Section",
        headerId: line.id,
        measuredIds: [],
      };
      groups.push(current);
      continue;
    }
    if (line.kind !== "measured") continue;
    if (!current) {
      current = {
        key: "__ungrouped__",
        label: "BoQ",
        measuredIds: [],
      };
      groups.push(current);
    }
    current.measuredIds.push(line.id);
  }

  return groups;
}

/** Measured ids currently selected that still exist on the BoQ. */
export function filterSelectedMeasuredLineIds(lines: TenderBoqLine[], selectedIds: string[]): string[] {
  const selected = new Set(selectedIds);
  return lines.filter((line) => line.kind === "measured" && selected.has(line.id)).map((line) => line.id);
}

/** Unpriced measured ids — used when confirming “price all unpriced”. */
export function unpricedMeasuredLineIds(lines: TenderBoqLine[]): string[] {
  return lines
    .filter((line) => line.kind === "measured" && !isBoqLinePriced(line))
    .map((line) => line.id);
}
