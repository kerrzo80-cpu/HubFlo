import * as XLSX from "xlsx";

/** Marker ref used when flattening multi-sheet workbooks for legacy row parsers. */
export const BOQ_SHEET_MARKER = "§SHEET§";

export type WorkbookSheetRows = {
  name: string;
  rows: string[][];
};

/** Preserve outer trim only — keep internal newlines from wrapped Excel cells. */
function cellToText(cell: string | number | Date | boolean | null | undefined): string {
  if (cell == null) return "";
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return cell.toISOString().slice(0, 10);
  }
  return String(cell).replace(/^\s+|\s+$/g, "");
}

function cellsFromSheet(sheet: unknown): string[][] {
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json<(string | number | Date | boolean | null | undefined)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
  return raw.map((row) => (Array.isArray(row) ? row : []).map((cell) => cellToText(cell)));
}

function isBlankRow(row: string[]) {
  return row.every((cell) => !String(cell || "").trim());
}

function isBoqHeaderRow(row: string[]) {
  const first = String(row[0] || "")
    .trim()
    .toLowerCase();
  if (first === "ref" || first === "item" || first === "item ref") return true;
  const joined = row.map((cell) => String(cell || "").trim().toLowerCase());
  const hasRef = joined.some((cell) => cell === "ref" || cell === "item" || cell === "item ref");
  const hasDesc = joined.some((cell) => cell.includes("description") || cell === "particulars" || cell === "spec");
  return hasRef && hasDesc;
}

/** Read every non-empty worksheet as its own page (preserves workbook tab names). */
export function workbookBoqSheetsFromBuffer(bytes: Buffer | ArrayBuffer): WorkbookSheetRows[] {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sheets: WorkbookSheetRows[] = [];
  for (const name of workbook.SheetNames) {
    const rows = cellsFromSheet(workbook.Sheets[name]).filter((row) => !isBlankRow(row));
    if (!rows.length) continue;
    sheets.push({ name, rows });
  }
  return sheets;
}

/** Read one sheet of an .xlsx/.xls buffer into rows of string cells. */
export function sheetRowsFromWorkbookBuffer(bytes: Buffer | ArrayBuffer, sheetIndex = 0): string[][] {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const name = workbook.SheetNames[sheetIndex];
  if (!name) return [];
  return cellsFromSheet(workbook.Sheets[name]);
}

/**
 * Read every non-empty worksheet and concatenate rows.
 * Multi-tab client BoQs often put each bill “page” on its own sheet — Tenders must not stop at sheet 0.
 * When 2+ sheets have data, inserts a §SHEET§ marker + sheet name (including the first)
 * and skips column header rows so “Ref / Description” is not imported as a measured line.
 */
export function allSheetRowsFromWorkbookBuffer(bytes: Buffer | ArrayBuffer): string[][] {
  const sheets = workbookBoqSheetsFromBuffer(bytes);
  const multiSheet = sheets.length > 1;
  const merged: string[][] = [];

  for (const { name, rows } of sheets) {
    if (multiSheet) {
      merged.push([BOQ_SHEET_MARKER, name]);
    }

    let start = 0;
    if (isBoqHeaderRow(rows[0] || []) && (multiSheet || merged.length > 0)) {
      start = 1;
    }

    for (let i = start; i < rows.length; i += 1) {
      merged.push(rows[i] || []);
    }
  }

  return merged;
}

export function rowsToDelimitedText(rows: string[][], delimiter = ",") {
  const escape = (value: string) => {
    if (delimiter === "\t") return value.replace(/\t/g, " ");
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  return rows.map((row) => row.map((cell) => escape(cell ?? "")).join(delimiter)).join("\n");
}

export function detectHeaderIndex(rows: string[][], candidates: string[]) {
  const lowered = candidates.map((item) => item.toLowerCase());
  for (let i = 0; i < rows.length; i += 1) {
    const cells = (rows[i] || []).map((cell) => cell.toLowerCase());
    if (lowered.every((name) => cells.includes(name))) return i;
  }
  return -1;
}
