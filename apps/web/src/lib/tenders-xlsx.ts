import * as XLSX from "xlsx";

function cellsFromSheet(sheet: unknown): string[][] {
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json<(string | number | Date | boolean | null | undefined)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
  return raw.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => {
      if (cell == null) return "";
      if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
        return cell.toISOString().slice(0, 10);
      }
      return String(cell).trim();
    }),
  );
}

function isBlankRow(row: string[]) {
  return row.every((cell) => !String(cell || "").trim());
}

function isBoqHeaderRow(row: string[]) {
  const first = String(row[0] || "")
    .trim()
    .toLowerCase();
  return first === "ref" || first === "item" || first === "item ref";
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
 * Inserts a section header from the sheet name between sheets, and skips duplicate column headers after the first.
 */
export function allSheetRowsFromWorkbookBuffer(bytes: Buffer | ArrayBuffer): string[][] {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const merged: string[][] = [];
  let emittedData = false;

  for (const name of workbook.SheetNames) {
    const rows = cellsFromSheet(workbook.Sheets[name]).filter((row) => !isBlankRow(row));
    if (!rows.length) continue;

    if (emittedData) {
      merged.push(["", name]);
    }

    let start = 0;
    if (emittedData && isBoqHeaderRow(rows[0] || [])) {
      start = 1;
    }

    for (let i = start; i < rows.length; i += 1) {
      merged.push(rows[i] || []);
    }
    emittedData = true;
  }

  return merged;
}

export function rowsToDelimitedText(rows: string[][], delimiter = ",") {
  const escape = (value: string) => {
    if (delimiter === "\t") return value.replace(/\t/g, " ");
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
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
