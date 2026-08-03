import { inflateRawSync } from "node:zlib";

export type BoqSheetRow = string[];

export type ParsedBoqLine = {
  ref: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number | null;
  sourceFileName: string;
  sheetName: string;
  rowNumber: number;
};

export type ParsedBoqWorkbook = {
  fileName: string;
  sheetName: string;
  headers: string[];
  lines: ParsedBoqLine[];
  skippedHeadings: number;
  notes: string[];
};

const BILL_REF = /^\d+\s*\/\s*\d+\s*\/\s*[a-z]$/i;
const HEADING_HINT =
  /^(bill no|internal |external |roof |heating |sanitary |soil|hot water|cold water|generally|protection|testing|towel|pvc |downpipes|roof plumber|radiators?|continued)/i;

function unzipLocalEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;

    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} in ${name || "xlsx"}`);
    }

    entries.set(name.replace(/\\/g, "/"), data);
    offset = dataStart + compSize;
  }

  if (!entries.size) {
    throw new Error("Could not read Excel zip entries from this .xlsx file.");
  }

  return entries;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function loadSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const siBody = match[1] ?? "";
    const parts = Array.from(siBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((part) => decodeXmlEntities(part[1] ?? ""));
    strings.push(parts.join(""));
  }
  return strings;
}

function columnIndex(ref: string) {
  const letters = ref.replace(/\d+/g, "");
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.toUpperCase().charCodeAt(0) - 64);
  }
  return index;
}

function rowIndex(ref: string) {
  return Number(ref.replace(/\D+/g, "")) || 0;
}

function sheetRowsFromXml(xml: string, shared: string[]): BoqSheetRow[] {
  const grid = new Map<string, string>();
  let maxRow = 0;
  let maxCol = 0;

  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
    const attrs = match[1] || match[3] || "";
    const body = match[2] || "";
    const refMatch = attrs.match(/\br="([A-Z]+\d+)"/i);
    if (!refMatch?.[1]) continue;
    const ref = refMatch[1].toUpperCase();
    const typeMatch = attrs.match(/\bt="([^"]+)"/i);
    const type = typeMatch?.[1] || "";
    let value = "";

    if (type === "inlineStr") {
      const texts = Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((part) => decodeXmlEntities(part[1] ?? ""));
      value = texts.join("");
    } else {
      const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const raw = valueMatch?.[1] != null ? decodeXmlEntities(valueMatch[1]) : "";
      if (type === "s") {
        const sharedIndex = Number(raw);
        value = Number.isFinite(sharedIndex) ? shared[sharedIndex] ?? "" : "";
      } else {
        value = raw;
      }
    }

    const row = rowIndex(ref);
    const col = columnIndex(ref);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
    grid.set(`${row}:${col}`, value.trim());
  }

  const rows: BoqSheetRow[] = [];
  for (let row = 1; row <= maxRow; row += 1) {
    const cells: string[] = [];
    for (let col = 1; col <= maxCol; col += 1) {
      cells.push(grid.get(`${row}:${col}`) ?? "");
    }
    rows.push(cells);
  }
  return rows;
}

function firstWorksheetPath(entries: Map<string, Buffer>) {
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const namedFirst = workbook.match(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/i);
  const idFirst = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"[^>]*\bname="([^"]+)"/i);
  let sheetName = "Sheet1";
  let relId = "";
  if (namedFirst?.[1] && namedFirst[2]) {
    sheetName = namedFirst[1];
    relId = namedFirst[2];
  } else if (idFirst?.[1] && idFirst[2]) {
    relId = idFirst[1];
    sheetName = idFirst[2];
  }

  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relMatch = rels.match(new RegExp(`Id="${relId}"[^>]*Target="([^"]+)"`, "i"))
    || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${relId}"`, "i"));
  const target = relMatch?.[1]?.replace(/^\//, "") ?? "worksheets/sheet1.xml";
  const path = target.startsWith("xl/") ? target : `xl/${target}`;
  return { sheetName, path };
}

export function readXlsxFirstSheet(buffer: Buffer): { sheetName: string; rows: BoqSheetRow[] } {
  const entries = unzipLocalEntries(buffer);
  const shared = loadSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const { sheetName, path } = firstWorksheetPath(entries);
  const sheetXml = entries.get(path)?.toString("utf8");
  if (!sheetXml) {
    throw new Error(`Worksheet ${path} was missing from the Excel file.`);
  }
  return { sheetName, rows: sheetRowsFromXml(sheetXml, shared) };
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findHeaderIndexes(header: string[]) {
  const normalized = header.map(normalizeHeader);
  const find = (...aliases: string[]) => normalized.findIndex((cell) => aliases.some((alias) => cell === alias || cell.includes(alias)));

  return {
    ref: find("ref", "item ref", "code"),
    description: find("description", "item description", "particulars", "details"),
    quantity: find("quantity", "qty"),
    units: find("units", "unit", "uom"),
    rate: find("rate", "unit rate", "price", "cost"),
  };
}

function parseNumber(value: string) {
  const cleaned = value.replace(/[£$,\s]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function looksLikeHeading(description: string, ref: string, quantity: number | null) {
  if (ref) return false;
  if (quantity !== null) return false;
  if (!description) return true;
  if (/continued/i.test(description)) return true;
  if (HEADING_HINT.test(description)) return true;
  if (description === description.toUpperCase() && description.length > 3) return true;
  return description.length < 80 && !/\d/.test(description);
}

function cleanSectionName(value: string) {
  return value.replace(/\s+continued\s*\.+/gi, "").replace(/\s+/g, " ").trim();
}

export function parseEnquiryBoqFromXlsx(buffer: Buffer, fileName: string): ParsedBoqWorkbook {
  const { sheetName, rows } = readXlsxFirstSheet(buffer);
  const notes: string[] = [];
  if (!rows.length) {
    return { fileName, sheetName, headers: [], lines: [], skippedHeadings: 0, notes: ["Excel sheet was empty."] };
  }

  let headerRowIndex = rows.findIndex((row) => {
    const joined = row.map(normalizeHeader).join(" | ");
    return joined.includes("description") && (joined.includes("quantity") || joined.includes("qty"));
  });
  if (headerRowIndex < 0) {
    headerRowIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "description"));
  }
  if (headerRowIndex < 0) {
    return {
      fileName,
      sheetName,
      headers: [],
      lines: [],
      skippedHeadings: 0,
      notes: ["Could not find a Description / Quantity header row in this Excel BOQ."],
    };
  }

  const headers = rows[headerRowIndex] ?? [];
  const indexes = findHeaderIndexes(headers);
  if (indexes.description < 0) {
    return {
      fileName,
      sheetName,
      headers,
      lines: [],
      skippedHeadings: 0,
      notes: ["Description column was not found in the Excel header row."],
    };
  }

  const tradeFromFile = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported BOQ";
  let section = tradeFromFile;
  let skippedHeadings = 0;
  const lines: ParsedBoqLine[] = [];

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const ref = String((indexes.ref >= 0 ? row[indexes.ref] : row[0]) ?? "").trim();
    const description = String(row[indexes.description] ?? "").trim();
    const quantityRaw = indexes.quantity >= 0 ? String(row[indexes.quantity] ?? "") : "";
    const unit = String((indexes.units >= 0 ? row[indexes.units] : "") ?? "").trim() || "item";
    const rate = indexes.rate >= 0 ? parseNumber(String(row[indexes.rate] ?? "")) : null;
    const quantity = parseNumber(quantityRaw);
    const normalizedDescription = description.toLowerCase();

    if (!description && !ref) continue;
    if (normalizedDescription === "total") continue;
    if (looksLikeHeading(description, ref, quantity)) {
      section = cleanSectionName(description) || section;
      skippedHeadings += 1;
      continue;
    }

    const hasBillRef = BILL_REF.test(ref.replace(/\s+/g, ""));
    if (!description) continue;
    if (!hasBillRef && quantity === null) {
      section = cleanSectionName(description) || section;
      skippedHeadings += 1;
      continue;
    }

    // Install-only preambles with a ref but no qty still belong on the schedule.
    lines.push({
      ref: ref.replace(/\s+/g, ""),
      section,
      description: ref ? `${ref.replace(/\s+/g, "")} · ${description}` : description,
      quantity: quantity ?? 1,
      unit: quantity === null ? "item" : unit,
      rate,
      sourceFileName: fileName,
      sheetName,
      rowNumber: index + 1,
    });
  }

  if (!lines.length) {
    notes.push("No priced bill lines were detected under the Description / Quantity headers.");
  } else {
    notes.push(`${lines.length} bill line(s) imported from ${fileName}.`);
  }

  return { fileName, sheetName, headers, lines, skippedHeadings, notes };
}

export function isExcelWorkbookFile(fileName: string, mimeType?: string | null) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return true;
  const mime = (mimeType || "").toLowerCase();
  return mime.includes("spreadsheetml") || mime.includes("excel");
}

export function boqLinesToPromptText(parsed: ParsedBoqWorkbook) {
  const body = parsed.lines
    .map((line) => `- [${line.section}] ${line.description} | qty ${line.quantity} ${line.unit}${line.rate != null ? ` | rate ${line.rate}` : ""}`)
    .join("\n");
  return [
    `Structured BOQ import from ${parsed.fileName} (sheet ${parsed.sheetName}).`,
    `Imported ${parsed.lines.length} line(s); skipped ${parsed.skippedHeadings} heading/total row(s).`,
    body || "(no lines)",
  ].join("\n");
}
