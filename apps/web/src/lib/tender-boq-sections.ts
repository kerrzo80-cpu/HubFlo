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

export function isBoqLinePriced(line: TenderBoqLine): boolean {
  const hasRate = typeof line.rate === "number" && Number.isFinite(line.rate);
  const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
  return hasRate || hasValue;
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
