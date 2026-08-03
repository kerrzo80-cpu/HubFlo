import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import {
  buildDayworkFormSections,
  dayworkAccountTotals,
  type DayworkAccountContext,
  type DayworkAccountRecord,
} from "@/lib/daywork-account-form";

const ink = rgb(0.09, 0.18, 0.23);
const muted = rgb(0.35, 0.44, 0.48);
const blue = rgb(0.08, 0.52, 0.72);
const line = rgb(0.81, 0.87, 0.89);

function safeText(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E£°]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export async function createDayworkAccountPdf(context: DayworkAccountContext) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Daywork Account - ${context.jobRef}`);
  pdf.setAuthor("Errol Watson Group Ltd - NeXa");
  pdf.setSubject("Daywork Account variation sheet");
  pdf.setCreator("NeXa Core");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 40;
  const pageWidth = PageSizes.A4[0];
  const contentWidth = pageWidth - margin * 2;
  let page!: PDFPage;
  let y = 0;

  function addPage() {
    page = pdf.addPage(PageSizes.A4);
    y = PageSizes.A4[1] - margin;
    page.drawText("DAYWORK ACCOUNT", { x: margin, y: y - 14, size: 16, font: bold, color: blue });
    page.drawText(safeText(context.jobRef), {
      x: pageWidth - margin - bold.widthOfTextAtSize(safeText(context.jobRef), 12),
      y: y - 14,
      size: 12,
      font: bold,
      color: ink,
    });
    y -= 34;
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: line });
    y -= 16;
  }

  function ensureSpace(needed: number) {
    if (y - needed < margin + 20) addPage();
  }

  function writeLabelValue(label: string, value: string) {
    const labelText = safeText(label);
    const valueLines = wrapText(value === "—" ? "" : value, regular, 10, contentWidth - 150);
    ensureSpace(18 + valueLines.length * 12);
    page.drawText(labelText, { x: margin, y, size: 9, font: bold, color: muted });
    valueLines.forEach((lineText, index) => {
      page.drawText(lineText || "—", {
        x: margin + 150,
        y: y - index * 12,
        size: 10,
        font: regular,
        color: ink,
      });
    });
    y -= Math.max(16, valueLines.length * 12 + 4);
  }

  addPage();
  page.drawText(safeText(`${context.customer} · ${context.site}`), {
    x: margin,
    y,
    size: 10,
    font: regular,
    color: muted,
  });
  y -= 22;

  const sections = buildDayworkFormSections(context);
  for (const section of sections) {
    if (section.section === "Sign-off") continue;
    ensureSpace(28);
    page.drawText(safeText(section.section.toUpperCase()), { x: margin, y, size: 11, font: bold, color: blue });
    y -= 16;
    for (const row of section.rows) {
      writeLabelValue(row.label, row.value);
    }
    y -= 6;
  }

  const record = context.record;
  const totals = dayworkAccountTotals(record);
  ensureSpace(40);
  page.drawText(`Sheet total: ${totals.total ? totals.total.toLocaleString("en-GB", { style: "currency", currency: "GBP" }) : "Pending office pricing"}`, {
    x: margin,
    y,
    size: 12,
    font: bold,
    color: ink,
  });
  y -= 28;

  ensureSpace(180);
  page.drawText("SIGN-OFF", { x: margin, y, size: 11, font: bold, color: blue });
  y -= 18;

  async function drawSigner(title: string, name?: string, signature?: string) {
    ensureSpace(90);
    page.drawText(safeText(title), { x: margin, y, size: 9, font: bold, color: muted });
    y -= 14;
    page.drawText(`Name: ${safeText(name) || "—"}`, { x: margin, y, size: 10, font: regular, color: ink });
    y -= 14;
    const image = await embedDataUrl(pdf, signature);
    if (image) {
      const size = image.scaleToFit(220, 55);
      page.drawRectangle({
        x: margin,
        y: y - size.height - 4,
        width: size.width + 8,
        height: size.height + 8,
        borderColor: line,
        borderWidth: 1,
      });
      page.drawImage(image, { x: margin + 4, y: y - size.height, width: size.width, height: size.height });
      y -= size.height + 18;
    } else if (signature && !signature.startsWith("data:image/")) {
      page.drawText(safeText(signature), { x: margin, y, size: 10, font: regular, color: ink });
      y -= 16;
    } else {
      page.drawText("Signature: —", { x: margin, y, size: 10, font: regular, color: muted });
      y -= 16;
    }
    y -= 8;
  }

  await drawSigner("Plumber / contractor", record?.plumberSignerName, record?.plumberSignature);
  await drawSigner("Client / Clerk of Works", record?.clientSignerName, record?.clientSignature);

  y -= 8;
  page.drawText("Attached with application for payment so the client can see who signed the daywork.", {
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
