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

/** Group BoQ lines into sheet/section blocks for select-all and header display. */
export function groupBoqLinesBySection(lines: TenderBoqLine[]): BoqSectionGroup[] {
  const groups: BoqSectionGroup[] = [];
  let current: BoqSectionGroup | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.kind === "header") {
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
