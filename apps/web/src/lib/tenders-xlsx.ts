import * as XLSX from "xlsx";

/** Read first sheet of an .xlsx/.xls buffer into rows of string cells. */
export function sheetRowsFromWorkbookBuffer(bytes: Buffer | ArrayBuffer, sheetIndex = 0): string[][] {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const name = workbook.SheetNames[sheetIndex];
  if (!name) return [];
  const sheet = workbook.Sheets[name];
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
