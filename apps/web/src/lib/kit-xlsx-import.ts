/**
 * Import bathroom/trade "kits" from the office Pre builds .xlsx template.
 *
 * Sheet layout (as used by EWG):
 *   Col A = kit name (only on the first row of each kit)
 *   Col B = item description
 *   Col D = quantity (optional)
 * Also accepts a two-column sheet: item | qty, with a kit title row such as "Bath".
 * Blank rows separate kits. Labour rows are detected by description.
 * Optional/blank qty rows (e.g. "TMV?") are skipped with a warning — they must not crash.
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

export type KitXlsxRowError = {
  row: number;
  message: string;
};

export type KitXlsxImportResult = {
  kits: ParsedKitDraft[];
  skippedRows: number;
  skippedOptional: number;
  rowErrors: KitXlsxRowError[];
  sheetName: string;
};

function cell(row: string[], index: number) {
  return String(row[index] ?? "").trim();
}

function parseQty(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
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
  return /^\s*labou?r\b/i.test(description) || /\bfirst fix labou?r\b/i.test(description) || /\blabou?r\b/i.test(description);
}

/** "1", "4", "1.5 hrs" — not an item description. */
function isQtyOnly(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (parseQty(value) === null) return false;
  const withoutUnit = value.replace(/\b(qty|hours?|hrs?|nr|each|no|nos|m|mm|lot)\b/gi, "").replace(/[^0-9.\-]/g, "");
  return withoutUnit.length > 0 && parseQty(withoutUnit) !== null && !/[a-z]{3,}/i.test(value.replace(/\b(qty|hours?|hrs?|nr|each|no|nos|m|mm|lot)\b/gi, ""));
}

function looksLikeComponent(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (/\?$/.test(value)) return true;
  if (/\b(optional|if required|tbc|provisional)\b/i.test(value)) return true;
  if (/\d+\s*[x×]\s*\d+/i.test(value)) return true;
  if (/\d+\s*mm\b/i.test(value)) return true;
  if (/\d+\s*\/\s*\d+\s*"/.test(value) || /\d+"/.test(value)) return true;
  if (
    /\b(elbow|coupling|couplings|panel|trap|bend|bends|timber|flexi|waste|overflow|filler|pipe length|press elbow|tap connect)/i.test(
      value,
    )
  ) {
    return true;
  }
  if (isLabourDescription(value)) return true;
  return false;
}

function looksOptionalBlank(description: string, qty: number | null) {
  if (qty !== null && qty > 0) return false;
  const value = description.trim();
  if (/\?$/.test(value)) return true;
  if (/\b(optional|if required|tbc)\b/i.test(value)) return true;
  if (/^tmv\b/i.test(value) && (qty === null || qty === 0)) return true;
  return qty === null || qty === 0;
}

/** Col-A text that is a note fragment, not a new kit title (template quirk on shower valve). */
function looksLikeKitTitle(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (looksLikeComponent(value)) return false;
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

function genericSheetName(sheetName: string) {
  const value = sheetName.trim();
  if (!value) return true;
  if (/^sheet\s*\d+$/i.test(value)) return true;
  if (/^pre\s*builds?$/i.test(value)) return true;
  return false;
}

/**
 * Parse the office Pre builds / kits workbook into draft kits (no IDs yet).
 * A bad row is recorded and skipped — never throws mid-sheet.
 */
export function parseKitsFromXlsxRows(rows: string[][], sheetName = "Sheet1"): KitXlsxImportResult {
  const kits: ParsedKitDraft[] = [];
  const rowErrors: KitXlsxRowError[] = [];
  let skippedRows = 0;
  let skippedOptional = 0;
  let current: ParsedKitDraft | null = null;

  const startKit = (name: string) => {
    current = {
      name: name.replace(/\s+/g, " ").trim(),
      category: defaultCategory(name),
      lines: [],
    };
    kits.push(current);
    return current;
  };

  const ensureKit = () => {
    if (current) return current;
    const fallback = genericSheetName(sheetName) ? "Imported kit" : sheetName.trim();
    return startKit(fallback);
  };

  const pushLine = (description: string, qtyRaw: string, noteExtra?: string, rowNumber = 0) => {
    const desc = description.trim();
    if (!desc) {
      skippedRows += 1;
      return;
    }
    const labour = isLabourDescription(desc);
    const fromText = hoursFromDescription(desc);
    const qty = parseQty(qtyRaw);
    if (!labour && looksOptionalBlank(desc, qty)) {
      skippedOptional += 1;
      skippedRows += 1;
      rowErrors.push({
        row: rowNumber,
        message: `Skipped optional row “${desc}” (no quantity).`,
      });
      return;
    }
    const host = ensureKit();
    if (noteExtra) {
      host.notes = [host.notes, noteExtra].filter(Boolean).join(" ").trim() || undefined;
    }
    const quantity = labour ? qty ?? fromText ?? 1 : qty ?? 1;
    if (!Number.isFinite(quantity) || quantity < 0) {
      skippedRows += 1;
      rowErrors.push({
        row: rowNumber,
        message: `Skipped “${desc}” — quantity is not a number.`,
      });
      return;
    }
    if (!labour && quantity === 0) {
      skippedOptional += 1;
      skippedRows += 1;
      return;
    }
    host.lines.push({
      kind: labour ? "Labour" : "Material",
      description: desc,
      quantity,
      unitCost: 0,
      unit: labour ? "hrs" : "each",
    });
  };

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    try {
      const kitCell = cell(row, 0);
      const itemCell = cell(row, 1);
      const qtyCell = cell(row, 3) || cell(row, 2);

      if (!kitCell && !itemCell) return;
      // Title / header rows
      if (!kitCell && /^item$/i.test(itemCell)) return;
      if (!kitCell && /^pre\s*builds?$/i.test(itemCell)) return;
      if (!kitCell && /^qty$/i.test(qtyCell) && !itemCell) return;

      // Two-column: description | qty (qty in column B).
      if (kitCell && isQtyOnly(itemCell)) {
        pushLine(kitCell, itemCell, undefined, rowNumber);
        return;
      }

      if (kitCell && looksLikeKitTitle(kitCell)) {
        startKit(kitCell);
        if (itemCell && !isQtyOnly(itemCell)) pushLine(itemCell, qtyCell || cell(row, 2), undefined, rowNumber);
        else if (!itemCell && parseQty(qtyCell) === null) skippedRows += 1;
        else if (!itemCell && parseQty(qtyCell) !== null) pushLine(kitCell, qtyCell, undefined, rowNumber);
        return;
      }

      if (kitCell && !looksLikeKitTitle(kitCell)) {
        // Continuation note in A, or a component row under the open kit.
        const desc = itemCell && !isQtyOnly(itemCell) ? itemCell : kitCell;
        const qty = isQtyOnly(itemCell) ? itemCell : qtyCell || cell(row, 2);
        pushLine(desc, qty, itemCell && desc === itemCell ? kitCell : undefined, rowNumber);
        return;
      }

      if (itemCell) {
        pushLine(itemCell, qtyCell || cell(row, 2), undefined, rowNumber);
        return;
      }

      skippedRows += 1;
    } catch (error) {
      skippedRows += 1;
      rowErrors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "This row could not be read.",
      });
    }
  });

  const cleaned = kits.filter((kit) => kit.lines.length > 0);
  return { kits: cleaned, skippedRows, skippedOptional, rowErrors, sheetName };
}

export function parseKitsFromXlsxBuffer(buffer: Buffer, fileName = "kits.xlsx"): KitXlsxImportResult {
  const { sheetName, rows } = readXlsxFirstSheet(buffer);
  const parsed = parseKitsFromXlsxRows(rows, sheetName);
  if (!parsed.kits.length) {
    throw new Error(
      `No kits found in ${fileName}. Expected a kit name (e.g. Bath) then item rows with quantities. Optional blank rows such as TMV? are skipped.`,
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
    const kitId = idForName(draft.name);
    const lines: PrebuildLine[] = draft.lines.map((line, index) => ({
      id: `${kitId}-line-${index + 1}`,
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unit: line.unit,
    }));
    return {
      id: kitId,
      name: draft.name,
      category: draft.category,
      notes: draft.notes,
      lines,
    };
  });
}
