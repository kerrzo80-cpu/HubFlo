/**
 * PDF BoQ → sheet matrix adapter.
 * Reuses takeoff PDF text extraction, then rebuilds table-like rows for parseBoqFromRows.
 * Text-based PDFs only (no OCR) — scanned bills fail with a clear message.
 * Handles supplier quotation layouts:
 * - Filpumps sales-order (Qty Ordered / Product Code / Unit Price / Net Price)
 * - William Wilson merchant quotes (LINE / PRODUCT CODE / QTY. / PRICE / NET VALUE)
 */

import { friendlyPdfEngineError } from "@/lib/pdf-engine-errors";
import {
  extractPdfDocument,
  type ExtractedPdfDocument,
  type ExtractedPdfPage,
  type ExtractedPdfTextItem,
} from "@/lib/takeoff-pdf-extract";
import { looksLikeTakeoffPipeMetreLine } from "@/lib/tender-boq-sections";
import type { WorkbookSheetRows } from "@/lib/tenders-xlsx";

export { looksLikeTakeoffPipeMetreLine } from "@/lib/tender-boq-sections";

const LINE_Y_TOLERANCE = 4;
const COLUMN_GAP_MIN = 12;
const COLUMN_ALIGN_TOLERANCE = 8;

const SUPPLIER_QUOTE_HEADER = ["Ref", "Description", "Quantity", "Units", "Rate", "Value"] as const;

type LineCluster = {
  y: number;
  items: ExtractedPdfTextItem[];
};

type SupplierColumnBands = {
  qty: number;
  code: number;
  description: number;
  unitPrice: number;
  netPrice: number;
  vat: number;
};

/** William Wilson FOP quote columns (LINE · CODE · DESC · QTY · PRICE · … · NET VALUE). */
type WwColumnBands = {
  lineNo: number;
  code: number;
  description: number;
  qty: number;
  price: number;
  netValue: number;
};

function clusterItemsIntoLines(items: ExtractedPdfTextItem[]): LineCluster[] {
  const sorted = [...items].sort((a, b) => {
    // PDF y grows upward — higher y first (reading order top → bottom).
    if (Math.abs(b.y - a.y) > LINE_Y_TOLERANCE) return b.y - a.y;
    return a.x - b.x;
  });

  const lines: LineCluster[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= LINE_Y_TOLERANCE) {
      last.items.push(item);
      last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length;
      continue;
    }
    lines.push({ y: item.y, items: [item] });
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }
  return lines;
}

/** Infer left-edge column anchors from densely populated x positions. */
function inferColumnStarts(lines: LineCluster[]): number[] {
  const starts: number[] = [];
  for (const line of lines) {
    for (const item of line.items) {
      const x = item.x;
      const hit = starts.find((anchor) => Math.abs(anchor - x) <= COLUMN_ALIGN_TOLERANCE);
      if (hit == null) starts.push(x);
    }
  }
  starts.sort((a, b) => a - b);

  // Merge anchors that are too close (same column with jitter).
  const merged: number[] = [];
  for (const x of starts) {
    const prev = merged[merged.length - 1];
    if (prev == null || x - prev >= COLUMN_GAP_MIN) {
      merged.push(x);
    }
  }
  return merged.length ? merged : [0];
}

function assignItemsToColumns(items: ExtractedPdfTextItem[], columnStarts: number[]): string[] {
  const cells = columnStarts.map(() => "" as string);
  for (const item of items) {
    let best = 0;
    for (let i = 0; i < columnStarts.length; i += 1) {
      const start = columnStarts[i]!;
      const next = columnStarts[i + 1];
      if (next == null) {
        if (item.x + COLUMN_ALIGN_TOLERANCE >= start) best = i;
        break;
      }
      const mid = (start + next) / 2;
      if (item.x < mid) {
        best = i;
        break;
      }
      best = i + 1;
    }
    const existing = cells[best] || "";
    cells[best] = existing ? `${existing} ${item.text}` : item.text;
  }
  return cells.map((cell) => cell.replace(/\s+/g, " ").trim());
}

/**
 * When column inference is weak (few anchors), fall back to gap-splitting a single reading line.
 */
function gapSplitLine(items: ExtractedPdfTextItem[]): string[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const cells: string[] = [];
  let current = sorted[0]!.text;
  let prevRight = sorted[0]!.x + sorted[0]!.width;

  for (let i = 1; i < sorted.length; i += 1) {
    const item = sorted[i]!;
    const gap = item.x - prevRight;
    if (gap >= COLUMN_GAP_MIN) {
      cells.push(current.replace(/\s+/g, " ").trim());
      current = item.text;
    } else {
      current = `${current} ${item.text}`;
    }
    prevRight = item.x + item.width;
  }
  cells.push(current.replace(/\s+/g, " ").trim());
  return cells.filter(Boolean);
}

function lineJoinedText(line: LineCluster): string {
  return line.items
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoneyCell(raw: string): number | null {
  const cleaned = String(raw || "")
    .replace(/[£$€,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function pageHaystack(page: ExtractedPdfPage): string {
  return `${page.fullText || ""} ${page.textItems.map((item) => item.text).join(" ")}`.toLowerCase();
}

/** Filpumps-style sales order / quotation with Qty Ordered + Unit/Net Price. */
function looksLikeFilpumpsQuotePage(page: ExtractedPdfPage): boolean {
  const hay = pageHaystack(page);
  const hasQty = /\bqty\b/.test(hay) && /\bordered\b/.test(hay);
  const hasProduct =
    (/product\s*code/.test(hay) || /\bcode\b/.test(hay)) &&
    (/product\s*description/.test(hay) || /\bdescription\b/.test(hay));
  const hasPrice = /unit\s*price/.test(hay) || /net\s*price/.test(hay);
  const looksLikeQuote =
    /\bquotation\b/.test(hay) ||
    /\bsales\s*order\b/.test(hay) ||
    /\bfilpumps\b/.test(hay) ||
    /\border\s*total\b/.test(hay);
  return (hasQty && hasProduct && hasPrice) || (looksLikeQuote && hasProduct && hasPrice);
}

/**
 * William Wilson merchant quotations (FOP PDF) — LINE / PRODUCT CODE / QTY. / PRICE / NET VALUE.
 * Deliberately distinct from Filpumps: no "Ordered", uses NET VALUE not Net Price.
 */
function looksLikeWilliamWilsonQuotePage(page: ExtractedPdfPage): boolean {
  const hay = pageHaystack(page);
  const hasWwTable =
    /\bproduct\s*code\b/.test(hay) &&
    /\bproduct\s*description\b/.test(hay) &&
    /\bqty\.?\b/.test(hay) &&
    (/\bnet\s*value\b/.test(hay) || /\bprice\b/.test(hay));
  const hasWwBrand =
    /\bwilliam\s*wilson\b/.test(hay) ||
    /\bnot\s+a\s+sales\s+order\b/.test(hay) ||
    /\btotal\s+goods\b/.test(hay);
  return hasWwTable && (hasWwBrand || /\bquotation\b/.test(hay) || /\bline\b/.test(hay));
}

function findSupplierHeaderLine(lines: LineCluster[]): LineCluster | null {
  for (const line of lines) {
    const text = lineJoinedText(line).toLowerCase();
    if (!text.includes("qty") && !text.includes("quantity")) continue;
    if (!text.includes("product") && !text.includes("description")) continue;
    if (!text.includes("price") && !text.includes("rate")) continue;
    return line;
  }
  return null;
}

function findTokenX(items: ExtractedPdfTextItem[], matcher: RegExp): number | null {
  for (const item of items) {
    if (matcher.test(item.text)) return item.x;
  }
  // Multi-token headers: "Unit" then "Price"
  for (let i = 0; i < items.length - 1; i += 1) {
    const pair = `${items[i]!.text} ${items[i + 1]!.text}`;
    if (matcher.test(pair)) return items[i]!.x;
  }
  return null;
}

function inferSupplierColumnBands(header: LineCluster): SupplierColumnBands {
  const items = header.items;
  const qty = findTokenX(items, /^qty$/i) ?? findTokenX(items, /quantity/i) ?? 27;
  // Prefer the multi-word header starts so code stays a narrow band.
  const code =
    findTokenX(items, /product\s*code/i) ??
    findTokenX(items, /^code$/i) ??
    findTokenX(items, /^product$/i) ??
    94;
  const description =
    findTokenX(items, /product\s*description/i) ??
    findTokenX(items, /^description$/i) ??
    176;
  const unitPrice =
    findTokenX(items, /unit\s*price/i) ?? findTokenX(items, /^unit$/i) ?? 394;
  const netPrice = findTokenX(items, /net\s*price/i) ?? findTokenX(items, /^net$/i) ?? 454;
  const vat = findTokenX(items, /vat\s*amount/i) ?? findTokenX(items, /^vat$/i) ?? 499;
  return { qty, code, description, unitPrice, netPrice, vat };
}

function bandForX(x: number, bands: SupplierColumnBands): keyof SupplierColumnBands {
  // Use the next column's left edge as the hard split — Filpumps qty values sit
  // under "Ordered", to the right of the "Qty" label midpoint.
  if (x < bands.code - 4) return "qty";
  if (x < bands.description - 4) return "code";
  if (x < bands.unitPrice - 4) return "description";
  if (x < bands.netPrice - 4) return "unitPrice";
  if (x < bands.vat - 4) return "netPrice";
  return "vat";
}

function assignSupplierCells(
  items: ExtractedPdfTextItem[],
  bands: SupplierColumnBands,
): Record<keyof SupplierColumnBands, string> {
  const cells: Record<keyof SupplierColumnBands, string> = {
    qty: "",
    code: "",
    description: "",
    unitPrice: "",
    netPrice: "",
    vat: "",
  };
  for (const item of items) {
    const key = bandForX(item.x, bands);
    cells[key] = cells[key] ? `${cells[key]} ${item.text}` : item.text;
  }
  for (const key of Object.keys(cells) as Array<keyof SupplierColumnBands>) {
    cells[key] = cells[key].replace(/\s+/g, " ").trim();
  }
  // Spill overflow: product codes are short tokens; longer words belong in description.
  if (cells.code) {
    const parts = cells.code.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      const kept: string[] = [];
      const spilled: string[] = [];
      for (const part of parts) {
        if (kept.length === 0 && part.length <= 24 && !/\s/.test(part)) kept.push(part);
        else spilled.push(part);
      }
      cells.code = kept.join(" ");
      if (spilled.length) {
        cells.description = [spilled.join(" "), cells.description].filter(Boolean).join(" ").trim();
      }
    }
  }
  return cells;
}

function isSupplierFooterLine(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\btotal\s+net\b/.test(lower) ||
    /\btotal\s+vat\b/.test(lower) ||
    /\border\s+total\b/.test(lower) ||
    /\btotal\s+goods\b/.test(lower) ||
    /\bbank\s+details\b/.test(lower) ||
    /\ball\s+prices\s+quoted\b/.test(lower) ||
    /\bsubject\s+to\s+our\s+terms\b/.test(lower) ||
    /\blegal\s+title\b/.test(lower) ||
    /\bterms\s+and\s+conditions\s+of\s+sale\b/.test(lower) ||
    /\bthis\s+quote\s+will\s+earn\b/.test(lower) ||
    /^text$/i.test(text.trim())
  );
}

function findWwHeaderLine(lines: LineCluster[]): LineCluster | null {
  for (const line of lines) {
    const text = lineJoinedText(line).toLowerCase();
    if (!/\bline\b/.test(text) && !findTokenX(line.items, /^line$/i)) continue;
    if (!text.includes("product") && !text.includes("description")) continue;
    if (!/\bqty\.?\b/.test(text) && !text.includes("quantity")) continue;
    if (!text.includes("price") && !text.includes("value")) continue;
    return line;
  }
  return null;
}

function inferWwColumnBands(header: LineCluster): WwColumnBands {
  const items = header.items;
  const lineNo = findTokenX(items, /^line$/i) ?? 17;
  // PRODUCT CODE / DESCRIPTION labels sit to the right of the value cells on WW FOP
  // quotes — anchor bands on value-column starts, not the wide header label left edges.
  const codeHeader =
    findTokenX(items, /product\s*code/i) ??
    findTokenX(items, /^product$/i) ??
    82;
  const descriptionHeader =
    findTokenX(items, /product\s*description/i) ??
    findTokenX(items, /^description$/i) ??
    354;
  const qty = findTokenX(items, /^qty\.?$/i) ?? findTokenX(items, /quantity/i) ?? 624;
  const price = findTokenX(items, /^price$/i) ?? 664;
  const netValue =
    findTokenX(items, /net\s*value/i) ?? findTokenX(items, /^net$/i) ?? findTokenX(items, /^value$/i) ?? 778;
  const code = lineNo + 22;
  const description = Math.min(codeHeader, Math.max(code + 36, descriptionHeader - 160));
  return { lineNo, code, description, qty, price, netValue };
}

type WwCellKey = keyof WwColumnBands | "skip";

function wwBandForX(x: number, bands: WwColumnBands): WwCellKey {
  if (x < bands.code - 4) return "lineNo";
  if (x < bands.description - 4) return "code";
  if (x < bands.qty - 4) return "description";
  if (x < bands.price - 4) return "qty";
  // Absorb %DISC / PER / VAT between unit price and net value.
  const mid = (bands.price + bands.netValue) / 2;
  if (x < bands.netValue - 24) {
    return x < mid ? "price" : "skip";
  }
  return "netValue";
}

function assignWwCells(
  items: ExtractedPdfTextItem[],
  bands: WwColumnBands,
): Record<keyof WwColumnBands, string> {
  const cells: Record<keyof WwColumnBands, string> = {
    lineNo: "",
    code: "",
    description: "",
    qty: "",
    price: "",
    netValue: "",
  };
  for (const item of items) {
    const key = wwBandForX(item.x, bands);
    if (key === "skip") continue;
    cells[key] = cells[key] ? `${cells[key]} ${item.text}` : item.text;
  }
  for (const key of Object.keys(cells) as Array<keyof WwColumnBands>) {
    cells[key] = cells[key].replace(/\s+/g, " ").trim();
  }
  return cells;
}

function pushSupplierMeasuredRow(
  rows: string[][],
  opts: { code: string; description: string; qty: number | null; rate: number | null; net: number | null },
): void {
  const { code, description } = opts;
  if (!description && !code) return;
  if (looksLikeTakeoffPipeMetreLine(code, description)) return;

  const qty = opts.qty;
  const rate = opts.rate;
  const net = opts.net;
  if (qty === null && rate === null && net === null) return;
  if ((qty === 0 || qty === null) && (rate === 0 || rate === null) && (net === 0 || net === null)) {
    return;
  }

  const quantity = qty !== null && qty > 0 ? qty : 1;
  const unitRate = rate ?? net;
  const value =
    net !== null && net > 0
      ? net
      : unitRate !== null
        ? Math.round(unitRate * quantity * 100) / 100
        : null;

  rows.push([
    code || "",
    description || code || "Supplier item",
    String(quantity),
    "nr",
    unitRate !== null ? String(unitRate) : "",
    value !== null ? String(value) : "",
  ]);
}

/**
 * Filpumps sales-order / quotation line table → BoQ-shaped rows.
 * Skips memo rows (qty 0 / code M) and keeps priced supply lines + carriage.
 */
function pdfPageToFilpumpsQuoteRows(page: ExtractedPdfPage): string[][] | null {
  if (!looksLikeFilpumpsQuotePage(page)) return null;
  const lines = clusterItemsIntoLines(page.textItems);
  const header = findSupplierHeaderLine(lines);
  if (!header) return null;

  const bands = inferSupplierColumnBands(header);
  const rows: string[][] = [SUPPLIER_QUOTE_HEADER.slice()];
  let headerSeen = false;

  for (const line of lines) {
    if (line === header) {
      headerSeen = true;
      continue;
    }
    if (!headerSeen) continue;

    const joined = lineJoinedText(line);
    if (!joined) continue;
    if (isSupplierFooterLine(joined)) break;

    const cells = assignSupplierCells(line.items, bands);
    const qty = parseMoneyCell(cells.qty);
    const rate = parseMoneyCell(cells.unitPrice);
    const net = parseMoneyCell(cells.netPrice);
    const code = cells.code.trim();
    const description = cells.description.trim();

    // Memo / comment rows on Filpumps-style quotes use qty 0 and code "M".
    if ((qty === 0 || qty === null) && /^m$/i.test(code)) continue;

    pushSupplierMeasuredRow(rows, { code, description, qty, rate, net });
  }

  return rows.length > 1 ? rows : null;
}

/**
 * William Wilson quotation line table → BoQ-shaped rows.
 * ZTEXT / zero-net rows become section headers; priced SKUs become measured lines.
 */
export function pdfPageToWilliamWilsonQuoteRows(page: ExtractedPdfPage): string[][] | null {
  if (!looksLikeWilliamWilsonQuotePage(page)) return null;
  const lines = clusterItemsIntoLines(page.textItems);
  const header = findWwHeaderLine(lines);
  if (!header) return null;

  const bands = inferWwColumnBands(header);
  const rows: string[][] = [SUPPLIER_QUOTE_HEADER.slice()];
  let headerSeen = false;

  for (const line of lines) {
    if (line === header) {
      headerSeen = true;
      continue;
    }
    if (!headerSeen) continue;

    const joined = lineJoinedText(line);
    if (!joined) continue;
    if (isSupplierFooterLine(joined)) break;

    // Skip letterhead / address blocks that share the page below the table break.
    if (/^\*{0,3}\s*not\s+a\s+sales\s+order/i.test(joined)) break;
    if (/^quotation$/i.test(joined.trim())) break;
    if (/william\s*wilson/i.test(joined) && !/\b(vlt|htm|yz|dn-|exc|exd|arg|hs\d)/i.test(joined)) {
      // Brand/footer lines after the table — stop once we leave product rows.
      if (!/^\d+\s+\S+/.test(joined) && !findTokenX(line.items, /^\d+$/)) break;
    }

    const cells = assignWwCells(line.items, bands);
    const lineNo = cells.lineNo.trim();
    const code = cells.code.trim();
    const description = cells.description.trim();
    const qty = parseMoneyCell(cells.qty);
    const rate = parseMoneyCell(cells.price);
    const net = parseMoneyCell(cells.netValue);

    if (!description && !code) continue;
    // Require a numeric LINE marker so address noise is ignored.
    if (lineNo && !/^\d+$/.test(lineNo)) continue;
    if (!lineNo && !code) continue;

    // Section banners (Apartment / Control Suggestion / UFH Kit Option…).
    if (/^ztext$/i.test(code) || ((rate === 0 || rate === null) && (net === 0 || net === null))) {
      const label = (
        /^ztext$/i.test(code) ? description : description.replace(/^ztext\s+/i, "")
      ).trim();
      if (label) rows.push(["", label, "", "", "", ""]);
      continue;
    }

    pushSupplierMeasuredRow(rows, { code, description, qty, rate, net });
  }

  return rows.length > 1 ? rows : null;
}

/**
 * Supplier sales-order / quotation line table → BoQ-shaped rows.
 * Tries Filpumps first, then William Wilson merchant quotes.
 */
export function pdfPageToSupplierQuoteRows(page: ExtractedPdfPage): string[][] | null {
  return pdfPageToFilpumpsQuoteRows(page) || pdfPageToWilliamWilsonQuoteRows(page);
}

export function pdfPageToBoqRows(page: ExtractedPdfPage): string[][] {
  const supplierRows = pdfPageToSupplierQuoteRows(page);
  if (supplierRows?.length) return supplierRows;

  const lines = clusterItemsIntoLines(page.textItems);
  if (!lines.length) return [];

  const columnStarts = inferColumnStarts(lines);
  const useColumns = columnStarts.length >= 3;

  const rows: string[][] = [];
  for (const line of lines) {
    const cells = useColumns
      ? assignItemsToColumns(line.items, columnStarts)
      : gapSplitLine(line.items);
    if (cells.some((cell) => cell.trim())) {
      rows.push(cells);
    }
  }
  return rows;
}

function sheetNameFromPdfFile(doc: ExtractedPdfDocument): string {
  return (doc.fileName || "boq.pdf").replace(/\.[^.]+$/, "").trim() || "PDF";
}

function sheetNameForPdfPage(doc: ExtractedPdfDocument, page: ExtractedPdfPage): string {
  const base = sheetNameFromPdfFile(doc);
  if (doc.pageCount <= 1) return base;
  return `${base} · Page ${page.pageNumber}`;
}

function mergeSupplierQuoteSheets(
  doc: ExtractedPdfDocument,
  pages: ExtractedPdfPage[],
): WorkbookSheetRows[] | null {
  const pageRows = pages.map((page) => pdfPageToSupplierQuoteRows(page));
  if (!pageRows.some((rows) => rows && rows.length > 1)) return null;

  const merged: string[][] = [SUPPLIER_QUOTE_HEADER.slice()];
  for (const rows of pageRows) {
    if (!rows?.length) continue;
    for (let i = 1; i < rows.length; i += 1) {
      merged.push(rows[i]!);
    }
  }
  if (merged.length <= 1) return null;
  // One tab per PDF file (not per page) — Add-to-BoQ names tabs from the filename.
  return [{ name: sheetNameFromPdfFile(doc), rows: merged }];
}

export function workbookBoqSheetsFromPdfDocument(doc: ExtractedPdfDocument): WorkbookSheetRows[] {
  const selectable = doc.pages.filter((page) => page.hasSelectableText);
  if (!selectable.length) {
    throw new Error(
      "This PDF has no selectable text (likely a scan). Export the BoQ as Excel/CSV, or use a text-based PDF / OCR, then re-import.",
    );
  }

  const supplierSheets = mergeSupplierQuoteSheets(doc, selectable);
  if (supplierSheets?.length) return supplierSheets;

  const sheets: WorkbookSheetRows[] = [];
  for (const page of selectable) {
    const rows = pdfPageToBoqRows(page);
    if (!rows.length) continue;
    sheets.push({
      name: sheetNameForPdfPage(doc, page),
      rows,
    });
  }

  if (!sheets.length) {
    throw new Error("Could not read any BoQ rows from this PDF.");
  }
  return sheets;
}

export async function workbookBoqSheetsFromPdfBuffer(
  bytes: Buffer,
  fileName = "boq.pdf",
): Promise<WorkbookSheetRows[]> {
  try {
    const doc = await extractPdfDocument(bytes, fileName);
    return workbookBoqSheetsFromPdfDocument(doc);
  } catch (error) {
    throw new Error(friendlyPdfEngineError(error, "Could not read any BoQ rows from this PDF."));
  }
}

/** Pure helper for tests — build a fake page from positioned strings. */
export function syntheticPdfPage(
  pageNumber: number,
  items: Array<{ text: string; x: number; y: number; width?: number; height?: number }>,
): ExtractedPdfPage {
  const textItems: ExtractedPdfTextItem[] = items.map((item) => ({
    text: item.text,
    x: item.x,
    y: item.y,
    width: item.width ?? Math.max(6, item.text.length * 5),
    height: item.height ?? 10,
  }));
  return {
    pageNumber,
    width: 600,
    height: 800,
    textItems,
    fullText: textItems.map((i) => i.text).join(" "),
    hasSelectableText: textItems.length > 0,
  };
}
