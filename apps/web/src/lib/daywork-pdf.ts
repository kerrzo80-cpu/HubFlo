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
  stripDayworkCostsForClientCopy,
  type DayworkAccountContext,
  type DayworkAccountRecord,
  type DayworkLineItem,
} from "@/lib/daywork-account-form";
import { readBrandingAsset } from "@/lib/branding-assets";
import { normalizeBusinessBranding } from "@/lib/branding";
import {
  hexToPdfRgb,
  normalizeFormDocumentTemplate,
  resolveFormDocumentChrome,
  type FormDocumentTemplate,
} from "@/lib/form-document-chrome";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { isPlaceholderCompanyRegistration } from "@/lib/commercial-safeguards";

const ink = rgb(0.08, 0.12, 0.16);
const muted = rgb(0.35, 0.4, 0.45);
const rule = rgb(0.55, 0.6, 0.65);
const light = rgb(0.93, 0.94, 0.95);
const defaultBrand = rgb(0.08, 0.5, 0.66);

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

async function embedLogoBytes(pdf: PDFDocument, buffer: Buffer, mimeType: string): Promise<PDFImage | undefined> {
  try {
    if (mimeType.includes("png")) return pdf.embedPng(buffer);
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return pdf.embedJpg(buffer);
    try {
      return await pdf.embedPng(buffer);
    } catch {
      return pdf.embedJpg(buffer);
    }
  } catch {
    return undefined;
  }
}

async function embedCompanyLogo(pdf: PDFDocument, logoUrl: string): Promise<PDFImage | undefined> {
  if (!logoUrl) return undefined;
  if (logoUrl.startsWith("data:image/")) return embedDataUrl(pdf, logoUrl);

  const clean = (logoUrl.split("?")[0] || logoUrl).trim();
  if (clean.startsWith("/api/branding/assets/")) {
    const kind = clean.includes("/icon") ? "icon" : "logo";
    const asset = readBrandingAsset(kind === "icon" ? "icon" : "logo") || readBrandingAsset("logo");
    if (asset) return embedLogoBytes(pdf, asset.buffer, asset.mimeType);
  }

  if (clean.startsWith("/")) {
    const relative = clean.replace(/^\//, "");
    const candidates = [
      path.join(process.cwd(), "public", relative),
      path.join(process.cwd(), "apps", "web", "public", relative),
    ];
    const file = candidates.find((candidate) => existsSync(candidate));
    if (file) {
      const buffer = readFileSync(file);
      const lower = file.toLowerCase();
      return embedLogoBytes(
        pdf,
        buffer,
        lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "image/png",
      );
    }
  }

  const uploaded = readBrandingAsset("logo");
  if (uploaded) return embedLogoBytes(pdf, uploaded.buffer, uploaded.mimeType);

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

function resolveDayworkChrome() {
  const hub = getHubDetailState();
  const business = normalizeBusinessBranding(hub.businessSettings);
  const templates = Array.isArray(hub.formTemplates) ? (hub.formTemplates as FormDocumentTemplate[]) : [];
  const raw = templates.find((template) => template.layout === "daywork-account");
  const template = normalizeFormDocumentTemplate(
    raw || {
      id: "form-template-daywork",
      layout: "daywork-account",
      name: "Daywork Account",
      title: "Daywork Account",
      intro: "",
      footer: "",
      terms: "",
      defaultAudience: "Client",
      includeCostCentreBreakdown: false,
      includePnl: false,
      includeAcceptance: false,
      includeBankDetails: false,
      headerNote: "",
      showLogo: true,
      logoUrl: "",
      headerColor: "",
      showCompanyDetails: true,
      showVatCompanyNumbers: true,
      acceptanceLabel: "",
    },
  );
  return resolveFormDocumentChrome(template, business);
}

function padLines(items: DayworkLineItem[], minRows: number) {
  const rows = [...items];
  while (rows.length < minRows) rows.push({ description: "", qty: "" });
  return rows;
}

/** Classic Daywork Account paper layout — week grid, materials/plant tables, named signatures. */
export async function createDayworkAccountPdf(context: DayworkAccountContext) {
  const chrome = resolveDayworkChrome();
  const brandChannels = hexToPdfRgb(chrome.headerColor);
  const brand = brandChannels ? rgb(brandChannels.r, brandChannels.g, brandChannels.b) : defaultBrand;

  const pdf = await PDFDocument.create();
  const clientCopy = context.variant === "client";
  const sheetTitle = chrome.title || "Daywork Account";
  pdf.setTitle(`${sheetTitle} - ${context.jobRef}${clientCopy ? " (client copy)" : ""}`);
  pdf.setAuthor(chrome.tradingName);
  pdf.setSubject(clientCopy ? `${sheetTitle} client copy — hours and materials` : `${sheetTitle} variation sheet`);
  pdf.setCreator(chrome.tradingName);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = chrome.showLogo ? await embedCompanyLogo(pdf, chrome.logoUrl) : undefined;
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

  // Masthead — paper Daywork Account style (logo/title/colours from Setup → Customise forms)
  const mastheadTitle = safeText(sheetTitle).toUpperCase() || "DAYWORK ACCOUNT";
  const mastheadNote = clientCopy
    ? "Client copy — hours & materials"
    : chrome.headerNote || chrome.tradingName;
  if (logo) {
    const size = logo.scaleToFit(118, 40);
    page.drawImage(logo, { x: margin, y: y - size.height, width: size.width, height: size.height });
    page.drawText(mastheadTitle, {
      x: margin + size.width + 14,
      y: y - 16,
      size: 16,
      font: bold,
      color: brand,
    });
    page.drawText(safeText(mastheadNote), {
      x: margin + size.width + 14,
      y: y - 32,
      size: 9,
      font: regular,
      color: muted,
    });
    y -= Math.max(size.height, 36) + 8;
  } else {
    page.drawText(mastheadTitle, { x: margin, y: y - 16, size: 16, font: bold, color: brand });
    page.drawText(safeText(mastheadNote), {
      x: margin,
      y: y - 32,
      size: 9,
      font: regular,
      color: muted,
    });
    y -= 42;
  }
  if (chrome.showCompanyDetails) {
    const detail = [
      chrome.tradingName,
      chrome.address,
      [chrome.phone, chrome.contactEmail].filter(Boolean).join(" · "),
      chrome.showVatCompanyNumbers &&
      !isPlaceholderCompanyRegistration({
        vatNumber: chrome.vatNumber,
        companyNumber: chrome.companyNumber,
      })
        ? `VAT ${chrome.vatNumber} · Company ${chrome.companyNumber}`
        : "",
    ].filter(Boolean);
    for (const line of detail) {
      page.drawText(safeText(line), { x: margin, y, size: 8, font: regular, color: muted });
      y -= 11;
    }
    y -= 2;
  }
  drawRule(1.2);
  y -= 14;

  const record = clientCopy && context.record ? stripDayworkCostsForClientCopy(context.record) : context.record;
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
  if (!clientCopy) {
    drawFieldRow("Rate £/hr", record?.labourRate ? money(Number(record.labourRate)) : "Office to complete");
    drawFieldRow("Labour cost", money(totals.labourCost) || "Pending office rate");
  }
  y -= 4;

  function drawItemsTable(title: string, items: DayworkLineItem[], totalLabel: string, totalValue: string) {
    drawSectionTitle(title);
    ensureSpace(24);
    const qtyWidth = 54;
    const costWidth = clientCopy ? 0 : 72;
    const descWidth = contentWidth - qtyWidth - costWidth;
    page.drawText("Description", { x: margin + 4, y, size: 8, font: bold, color: muted });
    page.drawText("Qty", { x: margin + descWidth + 4, y, size: 8, font: bold, color: muted });
    if (!clientCopy) {
      page.drawText("£", { x: margin + descWidth + qtyWidth + 4, y, size: 8, font: bold, color: muted });
    }
    y -= 4;
    drawRule(0.6);
    y -= 12;

    for (const item of padLines(items, 4)) {
      ensureSpace(16);
      const amount = clientCopy ? 0 : dayworkLineAmount(item);
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
      if (!clientCopy) {
        page.drawText(amount ? money(amount) : "—", {
          x: margin + descWidth + qtyWidth + 4,
          y,
          size: 9,
          font: regular,
          color: ink,
        });
      }
      y -= 14;
      for (const extra of descLines.slice(1)) {
        ensureSpace(12);
        page.drawText(safeText(extra), { x: margin + 4, y, size: 9, font: regular, color: ink });
        y -= 12;
      }
    }
    y -= 2;
    if (!clientCopy) {
      drawFieldRow(totalLabel, totalValue || "Office to price");
    }
    y -= 2;
  }

  drawItemsTable(
    "Materials",
    parseDayworkLineItems(record?.materialsJson),
    "Materials total",
    money(totals.materials),
  );
  drawItemsTable("Plant", parseDayworkLineItems(record?.plantJson), "Plant total", money(totals.plant));

  if (!clientCopy) {
    drawSectionTitle("Summary");
    drawFieldRow("Add % on mats/plant", totals.markupPercent ? `${totals.markupPercent}%` : "Office to complete");
    drawFieldRow("Sheet total", money(totals.total) || "Pending office pricing");
    y -= 6;
  }

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

  ensureSpace(28);
  const closingNote =
    chrome.footer ||
    chrome.terms ||
    (clientCopy
      ? `Client copy — hours and materials only. Rates and pricing are completed by ${chrome.tradingName} office.`
      : `This ${sheetTitle} attaches with the valuation / application for payment.`);
  for (const line of wrapText(closingNote, regular, 8, contentWidth)) {
    ensureSpace(12);
    page.drawText(safeText(line), {
      x: margin,
      y,
      size: 8,
      font: regular,
      color: muted,
    });
    y -= 10;
  }

  return Buffer.from(await pdf.save());
}

export function dayworkPdfFilename(
  record: DayworkAccountRecord | null | undefined,
  jobRef: string,
  variant: "office" | "client" = "office",
) {
  const week = String(record?.weekEnding || "sheet").replace(/[^\dA-Za-z-]+/g, "-");
  const ref = String(jobRef || "daywork").replace(/[^\dA-Za-z-]+/g, "-");
  const suffix = variant === "client" ? "-client-copy" : "";
  return `Daywork-Account-${ref}-${week}${suffix}.pdf`;
}
