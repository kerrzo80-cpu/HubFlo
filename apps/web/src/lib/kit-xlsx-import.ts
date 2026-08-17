/**
 * Import bathroom/trade "kits" from the office Pre builds .xlsx template.
 *
 * Sheet layout (as used by EWG):
 *   Col A = kit name (only on the first row of each kit)
 *   Col B = item description
 *   Col D = quantity (optional)
 * Blank rows separate kits. Labour rows are detected by description.
 */

import { readXlsxFirstSheet } from "@/lib/boq-xlsx";
import type { PrebuildKit, PrebuildLine, PrebuildLineKind } from "@/lib/prebuild-data";

export type ParsedKitDraft = {
  name: string;
  category: string;
  notes?: string;
  lines: Array<{
    kind: PrebuildLineKind;
    description: string;
    quantity: number;
    unitCost: number;
    unit?: string;
  }>;
};

export type KitXlsxImportResult = {
  kits: ParsedKitDraft[];
  skippedRows: number;
  sheetName: string;
};

function cell(row: string[], index: number) {
  return String(row[index] ?? "").trim();
}

function parseQty(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hoursFromDescription(description: string): number | null {
  const match = description.match(/(\d+(?:\.\d+)?)\s*hours?\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isLabourDescription(description: string) {
  return /\blabou?r\b/i.test(description);
}

/** Col-A text that is a note fragment, not a new kit title (template quirk on shower valve). */
function looksLikeKitTitle(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (/^(check\b|make sure\b|to\b|and\b|or\b|for\b)/i.test(value)) return false;
  if (/^[a-z]/.test(value) && value.length > 28) return false;
  if (/^(item|qty|pre\s*builds?)$/i.test(value)) return false;
  return true;
}

function defaultCategory(kitName: string) {
  const name = kitName.toLowerCase();
  if (/bath|basin|toilet|vanity|wetwall|shower|towel|plaster/.test(name)) return "Bathroom";
  if (/boiler|cylinder|radiator|heating/.test(name)) return "Heating";
  return "General";
}

/**
 * Parse the office Pre builds / kits workbook into draft kits (no IDs yet).
 */
export function parseKitsFromXlsxRows(rows: string[][], sheetName = "Sheet1"): KitXlsxImportResult {
  const kits: ParsedKitDraft[] = [];
  let skippedRows = 0;
  let current: ParsedKitDraft | null = null;

  const pushLine = (description: string, qtyRaw: string, noteExtra?: string) => {
    if (!current) {
      skippedRows += 1;
      return;
    }
    const desc = description.trim();
    if (!desc) {
      skippedRows += 1;
      return;
    }
    if (noteExtra) {
      current.notes = [current.notes, noteExtra].filter(Boolean).join(" ").trim() || undefined;
    }
    const labour = isLabourDescription(desc);
    const fromText = hoursFromDescription(desc);
    const qty = parseQty(qtyRaw);
    const quantity = labour ? qty ?? fromText ?? 1 : qty ?? 1;
    current.lines.push({
      kind: labour ? "Labour" : "Material",
      description: desc,
      quantity,
      unitCost: 0,
      unit: labour ? "hrs" : "each",
    });
  };

  for (const row of rows) {
    const kitCell = cell(row, 0);
    const itemCell = cell(row, 1);
    const qtyCell = cell(row, 3) || cell(row, 2);

    if (!kitCell && !itemCell) continue;
    // Title / header rows
    if (!kitCell && /^item$/i.test(itemCell)) continue;
    if (!kitCell && /^pre\s*builds?$/i.test(itemCell)) continue;
    if (!kitCell && /^qty$/i.test(qtyCell) && !itemCell) continue;

    if (kitCell && looksLikeKitTitle(kitCell)) {
      current = {
        name: kitCell.replace(/\s+/g, " ").trim(),
        category: defaultCategory(kitCell),
        lines: [],
      };
      kits.push(current);
      if (itemCell) pushLine(itemCell, qtyCell);
      else skippedRows += 1;
      continue;
    }

    if (kitCell && !looksLikeKitTitle(kitCell)) {
      // Continuation note parked in column A — keep under the open kit.
      pushLine(itemCell || kitCell, qtyCell, itemCell ? kitCell : undefined);
      continue;
    }

    if (itemCell) {
      pushLine(itemCell, qtyCell);
      continue;
    }

    skippedRows += 1;
  }

  const cleaned = kits.filter((kit) => kit.lines.length > 0);
  return { kits: cleaned, skippedRows, sheetName };
}

export function parseKitsFromXlsxBuffer(buffer: Buffer, fileName = "kits.xlsx"): KitXlsxImportResult {
  const { sheetName, rows } = readXlsxFirstSheet(buffer);
  const parsed = parseKitsFromXlsxRows(rows, sheetName);
  if (!parsed.kits.length) {
    throw new Error(
      `No kits found in ${fileName}. Expected kit name in column A, item in column B, qty in column D.`,
    );
  }
  return parsed;
}

/** Map drafts onto store-shaped kits (caller assigns stable ids when merging). */
export function draftsToPrebuildKits(
  drafts: ParsedKitDraft[],
  idForName: (name: string) => string,
): PrebuildKit[] {
  return drafts.map((draft) => {
    const lines: PrebuildLine[] = draft.lines.map((line, index) => ({
      id: `${idForName(draft.name)}-line-${index + 1}`,
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unit: line.unit,
    }));
    return {
      id: idForName(draft.name),
      name: draft.name,
      category: draft.category,
      notes: draft.notes,
      lines,
    };
  });
}
