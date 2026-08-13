/**
 * PDF BoQ → sheet matrix adapter.
 * Reuses takeoff PDF text extraction, then rebuilds table-like rows for parseBoqFromRows.
 * Text-based PDFs only (no OCR) — scanned bills fail with a clear message.
 * Also handles supplier sales-order / quotation layouts (Qty / Product Code / Description / Unit Price).
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

function looksLikeSupplierQuotePage(page: ExtractedPdfPage): boolean {
  const hay = `${page.fullText || ""} ${page.textItems.map((item) => item.text).join(" ")}`.toLowerCase();
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
    /\bbank\s+details\b/.test(lower) ||
    /\ball\s+prices\s+quoted\b/.test(lower) ||
    /\bsubject\s+to\s+our\s+terms\b/.test(lower) ||
    /\blegal\s+title\b/.test(lower)
  );
}

/**
 * Supplier sales-order / quotation line table → BoQ-shaped rows.
 * Skips memo rows (qty 0 / code M) and keeps priced supply lines + carriage.
 */
export function pdfPageToSupplierQuoteRows(page: ExtractedPdfPage): string[][] | null {
  if (!looksLikeSupplierQuotePage(page)) return null;
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
    if (!description && !code) continue;
    if (qty === null && rate === null && net === null) continue;
    if ((qty === 0 || qty === null) && (rate === 0 || rate === null) && (net === 0 || net === null)) {
      continue;
    }
    // Never invent takeoff pipe-metre lines on a supplier sales-order sheet.
    if (looksLikeTakeoffPipeMetreLine(code, description)) continue;

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

  return rows.length > 1 ? rows : null;
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

function sheetNameForPdfPage(doc: ExtractedPdfDocument, page: ExtractedPdfPage): string {
  const base = (doc.fileName || "boq.pdf").replace(/\.[^.]+$/, "").trim() || "PDF";
  if (doc.pageCount <= 1) return base;
  return `${base} · Page ${page.pageNumber}`;
}

export function workbookBoqSheetsFromPdfDocument(doc: ExtractedPdfDocument): WorkbookSheetRows[] {
  const selectable = doc.pages.filter((page) => page.hasSelectableText);
  if (!selectable.length) {
    throw new Error(
      "This PDF has no selectable text (likely a scan). Export the BoQ as Excel/CSV, or use a text-based PDF.",
    );
  }

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
