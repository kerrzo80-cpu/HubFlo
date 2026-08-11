/**
 * PDF BoQ → sheet matrix adapter.
 * Reuses takeoff PDF text extraction, then rebuilds table-like rows for parseBoqFromRows.
 * Text-based PDFs only (no OCR) — scanned bills fail with a clear message.
 */

import {
  extractPdfDocument,
  type ExtractedPdfDocument,
  type ExtractedPdfPage,
  type ExtractedPdfTextItem,
} from "@/lib/takeoff-pdf-extract";
import type { WorkbookSheetRows } from "@/lib/tenders-xlsx";

const LINE_Y_TOLERANCE = 4;
const COLUMN_GAP_MIN = 12;
const COLUMN_ALIGN_TOLERANCE = 8;

type LineCluster = {
  y: number;
  items: ExtractedPdfTextItem[];
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

export function pdfPageToBoqRows(page: ExtractedPdfPage): string[][] {
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
      name: `Page ${page.pageNumber}`,
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
  const doc = await extractPdfDocument(bytes, fileName);
  return workbookBoqSheetsFromPdfDocument(doc);
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
