/**
 * Tender BoQ → printable PDF (current sheet or full workbook).
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { filterBoqLinesBySheet, listBoqSheetTabs } from "@/lib/tender-boq-sections";
import type { TenderBoqLine } from "@/lib/tenders-types";
import { computeBoqTotal } from "@/lib/tenders-types";

function money(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value);
}

function qty(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function wrap(text: string, maxChars: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function buildTenderBoqPdfBuffer(
  lines: TenderBoqLine[],
  options?: {
    sheetKey?: string | null;
    title?: string;
    tenderName?: string;
  },
): Promise<Buffer> {
  const sheetKey = options?.sheetKey?.trim() || null;
  const exportLines = sheetKey ? filterBoqLinesBySheet(lines, sheetKey) : lines;
  const working = exportLines.length ? exportLines : lines;
  if (!working.length) {
    throw new Error("No BoQ lines to export.");
  }

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.15, 0.18);
  const muted = rgb(0.35, 0.4, 0.45);
  const lineColor = rgb(0.82, 0.86, 0.9);
  const headerBg = rgb(0.94, 0.96, 0.98);

  const pageWidth = 841.89; // landscape A4 — wide BoQ columns
  const pageHeight = 595.28;
  const marginX = 36;
  const topY = pageHeight - 36;
  const bottomY = 36;

  const col = {
    ref: marginX,
    desc: marginX + 70,
    qty: pageWidth - marginX - 220,
    unit: pageWidth - marginX - 170,
    rate: pageWidth - marginX - 120,
    amount: pageWidth - marginX - 60,
  };
  const descWidth = col.qty - col.desc - 8;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = topY;

  const ensure = (need: number) => {
    if (y - need >= bottomY) return;
    page = pdf.addPage([pageWidth, pageHeight]);
    y = topY;
    drawTableHeader();
  };

  const drawText = (
    text: string,
    x: number,
    size: number,
    font: typeof regular,
    color = ink,
    maxW?: number,
  ) => {
    let draw = text;
    if (maxW != null) {
      while (draw.length > 1 && font.widthOfTextAtSize(draw, size) > maxW) {
        draw = `${draw.slice(0, -2)}…`;
      }
    }
    page.drawText(draw, { x, y, size, font, color });
  };

  const drawTableHeader = () => {
    page.drawRectangle({
      x: marginX - 4,
      y: y - 4,
      width: pageWidth - marginX * 2 + 8,
      height: 18,
      color: headerBg,
    });
    drawText("Ref", col.ref, 9, bold, muted);
    drawText("Description", col.desc, 9, bold, muted);
    drawText("Qty", col.qty, 9, bold, muted, 40);
    drawText("Unit", col.unit, 9, bold, muted, 40);
    drawText("Rate", col.rate, 9, bold, muted, 50);
    drawText("Amount", col.amount, 9, bold, muted, 55);
    y -= 22;
  };

  const title = options?.title?.trim() || "BoQ";
  const tenderName = options?.tenderName?.trim() || "";
  drawText(title, marginX, 16, bold);
  y -= 18;
  if (tenderName) {
    drawText(tenderName, marginX, 10, regular, muted);
    y -= 14;
  }
  if (sheetKey) {
    drawText(`Sheet: ${sheetKey}`, marginX, 10, regular, muted);
    y -= 14;
  } else {
    const tabs = listBoqSheetTabs(working);
    if (tabs.length > 1) {
      drawText(`${tabs.length} sheet tabs`, marginX, 10, regular, muted);
      y -= 14;
    }
  }
  const total = computeBoqTotal(working);
  drawText(`BoQ total ${money(total)}`, marginX, 11, bold);
  y -= 20;
  drawTableHeader();

  let currentSheet = "";
  for (const line of working) {
    if (line.kind === "header") {
      const label = (line.section || line.description || "").trim();
      if (!label) continue;
      if (line.sheet && line.sheet !== currentSheet && !sheetKey) {
        currentSheet = line.sheet;
        ensure(36);
        y -= 6;
        drawText(`— ${currentSheet} —`, marginX, 10, bold, muted);
        y -= 16;
      }
      ensure(20);
      page.drawLine({
        start: { x: marginX, y: y + 10 },
        end: { x: pageWidth - marginX, y: y + 10 },
        thickness: 0.5,
        color: lineColor,
      });
      drawText(label, col.desc, 10, bold);
      y -= 16;
      continue;
    }

    if (line.kind === "note") {
      ensure(16);
      drawText(line.description || line.note || "", col.desc, 9, regular, muted, descWidth);
      y -= 14;
      continue;
    }

    const descLines = wrap(line.description || "", Math.max(40, Math.floor(descWidth / 5)));
    ensure(14 * descLines.length + 4);
    drawText(line.ref || "", col.ref, 9, regular, ink, 64);
    descLines.forEach((part, index) => {
      drawText(part, col.desc, 9, regular, ink, descWidth);
      if (index === 0) {
        drawText(qty(line.quantity), col.qty, 9, regular, ink, 40);
        drawText(line.unit || "", col.unit, 9, regular, ink, 40);
        drawText(money(line.rate), col.rate, 9, regular, ink, 50);
        drawText(money(line.value), col.amount, 9, regular, ink, 55);
      }
      y -= 12;
    });
    y -= 2;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

export function tenderBoqPdfFilename(tenderName: string, sheetKey?: string | null) {
  const safe = (tenderName || "tender").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "tender";
  const sheetSuffix = sheetKey
    ? `_${sheetKey.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`
    : "";
  return `BoQ_${safe}${sheetSuffix}.pdf`;
}
