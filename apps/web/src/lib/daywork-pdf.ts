import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import {
  DAYWORK_WEEKDAY_OPTIONS,
  dayworkAccountTotals,
  dayworkLineAmount,
  normalizeWeekLabourDays,
  parseDayworkLabourDays,
  parseDayworkLineItems,
  type DayworkAccountContext,
  type DayworkAccountRecord,
  type DayworkLineItem,
} from "@/lib/daywork-account-form";

const ink = rgb(0.08, 0.12, 0.16);
const muted = rgb(0.35, 0.4, 0.45);
const rule = rgb(0.55, 0.6, 0.65);
const light = rgb(0.93, 0.94, 0.95);
const brand = rgb(0.08, 0.5, 0.66); // EWG cyan

function safeText(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E£°]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = safeText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

async function embedDataUrl(pdf: PDFDocument, value?: string): Promise<PDFImage | undefined> {
  if (!value?.startsWith("data:image/")) return undefined;
  try {
    const match = value.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
    if (!match?.[1] || !match[2]) return undefined;
    const format = match[1];
    const bytes = Buffer.from(match[2], "base64");
    return /png/i.test(format) ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
  } catch {
    return undefined;
  }
}

async function embedEwgLogo(pdf: PDFDocument): Promise<PDFImage | undefined> {
  const candidates = [
    path.join(process.cwd(), "public", "ewg-logo.png"),
    path.join(process.cwd(), "apps", "web", "public", "ewg-logo.png"),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return undefined;
  try {
    return pdf.embedPng(readFileSync(file));
  } catch {
    return undefined;
  }
}

function padLines(items: DayworkLineItem[], minRows: number) {
  const rows = [...items];
  while (rows.length < minRows) rows.push({ description: "", qty: "" });
  return rows;
}

/** Classic Daywork Account paper layout — week grid, materials/plant tables, named signatures. */
export async function createDayworkAccountPdf(context: DayworkAccountContext) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Daywork Account - ${context.jobRef}`);
  pdf.setAuthor("Errol Watson Group Ltd - NeXa");
  pdf.setSubject("Daywork Account variation sheet");
  pdf.setCreator("NeXa Core");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedEwgLogo(pdf);
  const margin = 36;
  const pageWidth = PageSizes.A4[0];
  const pageHeight = PageSizes.A4[1];
  const contentWidth = pageWidth - margin * 2;
  let page!: PDFPage;
  let y = 0;

  function addPage() {
    page = pdf.addPage(PageSizes.A4);
    y = pageHeight - margin;
  }

  function ensureSpace(needed: number) {
    if (y - needed < margin + 24) addPage();
  }

  function drawRule(thickness = 0.8) {
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness,
      color: rule,
    });
  }

  function drawSectionTitle(title: string) {
    ensureSpace(22);
    page.drawRectangle({
      x: margin,
      y: y - 14,
      width: contentWidth,
      height: 16,
      color: light,
    });
    page.drawText(safeText(title).toUpperCase(), {
      x: margin + 6,
      y: y - 11,
      size: 9,
      font: bold,
      color: brand,
    });
    y -= 22;
  }

  function drawFieldRow(label: string, value: string, labelWidth = 120) {
    const lines = wrapText(value || " ", regular, 10, contentWidth - labelWidth - 8);
    ensureSpace(14 + (lines.length - 1) * 11);
    page.drawText(safeText(label), { x: margin, y, size: 9, font: bold, color: muted });
    lines.forEach((lineText, index) => {
      page.drawText(safeText(lineText) || "—", {
        x: margin + labelWidth,
        y: y - index * 11,
        size: 10,
        font: regular,
        color: ink,
      });
    });
    y -= Math.max(14, lines.length * 11 + 2);
  }

  addPage();

  // Masthead — paper Daywork Account style
  if (logo) {
    const size = logo.scaleToFit(118, 40);
    page.drawImage(logo, { x: margin, y: y - size.height, width: size.width, height: size.height });
    page.drawText("DAYWORK ACCOUNT", {
      x: margin + size.width + 14,
      y: y - 16,
      size: 18,
      font: bold,
      color: brand,
    });
    page.drawText("Errol Watson Group Ltd", {
      x: margin + size.width + 14,
      y: y - 32,
      size: 9,
      font: regular,
      color: muted,
    });
    y -= Math.max(size.height, 36) + 8;
  } else {
    page.drawText("DAYWORK ACCOUNT", { x: margin, y: y - 16, size: 18, font: bold, color: brand });
    page.drawText("Errol Watson Group Ltd", { x: margin, y: y - 32, size: 9, font: regular, color: muted });
    y -= 42;
  }
  drawRule(1.2);
  y -= 14;

  const record = context.record;
  const totals = dayworkAccountTotals(record);
  const weekDays = normalizeWeekLabourDays(parseDayworkLabourDays(record?.labourDaysJson));

  drawFieldRow("To (client)", context.customer);
  drawFieldRow("Contract / site", context.contract || context.site);
  drawFieldRow("Job No.", context.jobRef);
  drawFieldRow("Week ending", record?.weekEnding || "");
  drawFieldRow("Variation ref.", record?.voReference || "");
  drawFieldRow("Sheet No.", "1");
  y -= 4;

  drawSectionTitle("Description of works");
  const descriptionLines = wrapText(record?.description || " ", regular, 10, contentWidth - 8);
  ensureSpace(descriptionLines.length * 12 + 8);
  descriptionLines.forEach((lineText) => {
    page.drawText(safeText(lineText) || "—", { x: margin + 4, y, size: 10, font: regular, color: ink });
    y -= 12;
  });
  y -= 6;

  drawSectionTitle("Labour");
  drawFieldRow("Operative", record?.labourName || context.engineer || "");
  drawFieldRow("Trade", record?.labourTrade || "");

  // Mon–Sun hours grid
  ensureSpace(48);
  const dayCol = contentWidth / 7;
  page.drawText("Hours by day", { x: margin, y, size: 9, font: bold, color: muted });
  y -= 14;
  weekDays.forEach((row, index) => {
    const x = margin + index * dayCol;
    const label = DAYWORK_WEEKDAY_OPTIONS.find((day) => day.id === row.day)?.label.slice(0, 3) || row.day;
    page.drawRectangle({
      x,
      y: y - 28,
      width: dayCol - 4,
      height: 32,
      borderColor: rule,
      borderWidth: 0.7,
    });
    page.drawText(label, { x: x + 6, y: y - 10, size: 8, font: bold, color: muted });
    page.drawText(row.hours || "—", { x: x + 6, y: y - 24, size: 11, font: regular, color: ink });
  });
  y -= 42;
  drawFieldRow("Total hours", totals.labourHours ? String(totals.labourHours) : "");
  drawFieldRow("Rate £/hr", record?.labourRate ? money(Number(record.labourRate)) : "Office to complete");
  drawFieldRow("Labour cost", money(totals.labourCost) || "Pending office rate");
  y -= 4;

  function drawItemsTable(title: string, items: DayworkLineItem[], totalLabel: string, totalValue: string) {
    drawSectionTitle(title);
    ensureSpace(24);
    const qtyWidth = 54;
    const costWidth = 72;
    const descWidth = contentWidth - qtyWidth - costWidth;
    page.drawText("Description", { x: margin + 4, y, size: 8, font: bold, color: muted });
    page.drawText("Qty", { x: margin + descWidth + 4, y, size: 8, font: bold, color: muted });
    page.drawText("£", { x: margin + descWidth + qtyWidth + 4, y, size: 8, font: bold, color: muted });
    y -= 4;
    drawRule(0.6);
    y -= 12;

    for (const item of padLines(items, 4)) {
      ensureSpace(16);
      const amount = dayworkLineAmount(item);
      const descLines = wrapText(item.description || " ", regular, 9, descWidth - 8);
      page.drawText(safeText(descLines[0]) || "—", {
        x: margin + 4,
        y,
        size: 9,
        font: regular,
        color: ink,
      });
      page.drawText(safeText(item.qty) || "—", {
        x: margin + descWidth + 4,
        y,
        size: 9,
        font: regular,
        color: ink,
      });
      page.drawText(amount ? money(amount) : "—", {
        x: margin + descWidth + qtyWidth + 4,
        y,
        size: 9,
        font: regular,
        color: ink,
      });
      y -= 14;
      for (const extra of descLines.slice(1)) {
        ensureSpace(12);
        page.drawText(safeText(extra), { x: margin + 4, y, size: 9, font: regular, color: ink });
        y -= 12;
      }
    }
    y -= 2;
    drawFieldRow(totalLabel, totalValue || "Office to price");
    y -= 2;
  }

  drawItemsTable(
    "Materials",
    parseDayworkLineItems(record?.materialsJson),
    "Materials total",
    money(totals.materials),
  );
  drawItemsTable("Plant", parseDayworkLineItems(record?.plantJson), "Plant total", money(totals.plant));

  drawSectionTitle("Summary");
  drawFieldRow("Add % on mats/plant", totals.markupPercent ? `${totals.markupPercent}%` : "Office to complete");
  drawFieldRow("Sheet total", money(totals.total) || "Pending office pricing");
  y -= 6;

  drawSectionTitle("Sign-off");
  page.drawText("Printed names are required — signatures alone can be hard to read.", {
    x: margin,
    y,
    size: 8,
    font: regular,
    color: muted,
  });
  y -= 16;

  async function drawSignerBox(title: string, name?: string, signature?: string) {
    ensureSpace(110);
    const boxHeight = 96;
    page.drawRectangle({
      x: margin,
      y: y - boxHeight,
      width: contentWidth,
      height: boxHeight,
      borderColor: rule,
      borderWidth: 1,
    });
    page.drawText(safeText(title).toUpperCase(), {
      x: margin + 8,
      y: y - 14,
      size: 8,
      font: bold,
      color: brand,
    });
    page.drawText(`Printed name: ${safeText(name) || "—"}`, {
      x: margin + 8,
      y: y - 30,
      size: 11,
      font: bold,
      color: ink,
    });
    page.drawText("Signature:", {
      x: margin + 8,
      y: y - 46,
      size: 8,
      font: bold,
      color: muted,
    });
    const image = await embedDataUrl(pdf, signature);
    if (image) {
      const size = image.scaleToFit(260, 42);
      page.drawImage(image, {
        x: margin + 70,
        y: y - 46 - size.height + 8,
        width: size.width,
        height: size.height,
      });
    } else if (signature && !signature.startsWith("data:image/")) {
      page.drawText(safeText(signature), {
        x: margin + 70,
        y: y - 46,
        size: 10,
        font: regular,
        color: ink,
      });
    } else {
      page.drawText("—", { x: margin + 70, y: y - 46, size: 10, font: regular, color: muted });
    }
    y -= boxHeight + 10;
  }

  await drawSignerBox("Plumber / contractor", record?.plumberSignerName || record?.labourName, record?.plumberSignature);
  await drawSignerBox("Client / Clerk of Works", record?.clientSignerName, record?.clientSignature);

  ensureSpace(20);
  page.drawText("This Daywork Account attaches with the valuation / application for payment.", {
    x: margin,
    y,
    size: 8,
    font: regular,
    color: muted,
  });

  return Buffer.from(await pdf.save());
}

export function dayworkPdfFilename(record: DayworkAccountRecord | null | undefined, jobRef: string) {
  const week = String(record?.weekEnding || "sheet").replace(/[^\dA-Za-z-]+/g, "-");
  const ref = String(jobRef || "daywork").replace(/[^\dA-Za-z-]+/g, "-");
  return `Daywork-Account-${ref}-${week}.pdf`;
}
