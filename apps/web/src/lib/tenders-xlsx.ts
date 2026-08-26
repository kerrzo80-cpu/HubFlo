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

/** Minimal BoQ line shape for spreadsheet export (avoids pulling server data helpers). */
export type TenderBoqExportLine = {
  kind: "header" | "measured" | "note";
  ref?: string;
  description: string;
  quantity?: number | null;
  unit?: string;
  rate?: number | null;
  value?: number | null;
  note?: string;
  sheet?: string;
  section?: string;
};

const BOQ_EXPORT_HEADER = ["Ref", "Description", "Quantity", "Units", "Rate", "Value", "Note"];

function cellNumber(value: number | null | undefined): string | number {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return value;
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "BoQ";
  let candidate = cleaned;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = `${cleaned.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Flatten BoQ lines into spreadsheet rows (optional section echo for header rows). */
export function tenderBoqLinesToRows(lines: TenderBoqExportLine[]): string[][] {
  const rows: string[][] = [BOQ_EXPORT_HEADER.slice()];
  for (const line of lines) {
    if (line.kind === "header") {
      rows.push(["", (line.section || line.description || "").trim(), "", "", "", "", ""]);
      continue;
    }
    if (line.kind === "note") {
      rows.push(["", line.description || "", "", "", "", "", line.note || ""]);
      continue;
    }
    rows.push([
      line.ref || "",
      line.description || "",
      String(cellNumber(line.quantity)),
      line.unit || "",
      String(cellNumber(line.rate)),
      String(cellNumber(line.value)),
      line.note || "",
    ]);
  }
  return rows;
}

/**
 * Build an .xlsx workbook from tender BoQ lines.
 * - `sheetKey` set → one worksheet for that tab
 * - otherwise → one worksheet per BoQ sheet tab (or a single “BoQ” sheet)
 */
export function buildTenderBoqXlsxBuffer(
  lines: TenderBoqExportLine[],
  options?: { sheetKey?: string | null; title?: string },
): Buffer {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const sheetKey = options?.sheetKey?.trim() || null;

  if (sheetKey) {
    const filtered = lines.filter((line) => (line.sheet || "").trim() === sheetKey);
    const rows = tenderBoqLinesToRows(filtered.length ? filtered : lines);
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      sanitizeSheetName(sheetKey, usedNames),
    );
  } else {
    const order: string[] = [];
    const bySheet = new Map<string, TenderBoqExportLine[]>();
    for (const line of lines) {
      const key = line.sheet?.trim() || "";
      if (!key) continue;
      if (!bySheet.has(key)) {
        bySheet.set(key, []);
        order.push(key);
      }
      bySheet.get(key)!.push(line);
    }

    if (!order.length) {
      const title = options?.title?.trim() || "BoQ";
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet(tenderBoqLinesToRows(lines)),
        sanitizeSheetName(title, usedNames),
      );
    } else {
      // Include any unsheeted lines on a trailing tab so nothing is lost.
      const orphan = lines.filter((line) => !(line.sheet || "").trim());
      for (const key of order) {
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.aoa_to_sheet(tenderBoqLinesToRows(bySheet.get(key) || [])),
          sanitizeSheetName(key, usedNames),
        );
      }
      if (orphan.length) {
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.aoa_to_sheet(tenderBoqLinesToRows(orphan)),
          sanitizeSheetName("Other", usedNames),
        );
      }
    }
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function tenderBoqExportFilename(name: string, sheetKey?: string | null) {
  const safe = (name || "tender").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "tender";
  const sheet = sheetKey?.trim()
    ? `_${sheetKey.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`
    : "";
  return `BoQ_${safe}${sheet}.xlsx`;
}
