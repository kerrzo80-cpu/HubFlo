import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type SimpleDocumentRow = {
  description?: string;
  detail?: string;
  value?: string;
};

export type SimpleDocumentPdfInput = {
  filename?: string;
  title?: string;
  businessName?: string;
  reference?: string;
  recipient?: string;
  subject?: string;
  rows?: SimpleDocumentRow[];
  subtotal?: string;
  vat?: string;
  total?: string;
};

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function wrapText(text: string, maxCharacters = 86) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharacters && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

/** Shared A4 PDF used for statements, remittance, chase, and email attachments. */
export async function createSimpleDocumentPdf(document: SimpleDocumentPdfInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;

  const write = (text: string, options?: { size?: number; isBold?: boolean; color?: ReturnType<typeof rgb>; gap?: number }) => {
    const size = options?.size ?? 10;
    const lines = wrapText(text, size >= 16 ? 58 : 86);
    lines.forEach((line) => {
      if (y < 70) {
        page = pdf.addPage([595.28, 841.89]);
        y = 790;
      }
      page.drawText(line, {
        x: 48,
        y,
        size,
        font: options?.isBold ? bold : regular,
        color: options?.color ?? rgb(0.1, 0.2, 0.25),
      });
      y -= size + 5;
    });
    y -= options?.gap ?? 3;
  };

  write(cleanText(document.businessName, "NeXa"), { size: 11, isBold: true, color: rgb(0.08, 0.45, 0.62), gap: 10 });
  write(cleanText(document.title, "Document"), { size: 20, isBold: true, gap: 10 });
  write(`Reference: ${cleanText(document.reference, "To confirm")}`, { isBold: true });
  write(`Prepared for: ${cleanText(document.recipient, "Client")}`, { gap: 8 });
  write(cleanText(document.subject, ""), { size: 13, isBold: true, gap: 12 });

  (document.rows ?? []).slice(0, 120).forEach((row, index) => {
    const value = cleanText(row.value);
    write(`${index + 1}. ${cleanText(row.description, "Item")}${value ? `  ${value}` : ""}`, { isBold: true, gap: 0 });
    const detail = cleanText(row.detail);
    if (detail) write(detail, { size: 9, color: rgb(0.3, 0.35, 0.38), gap: 5 });
  });

  y -= 8;
  write(`Subtotal: ${cleanText(document.subtotal, "TBC")}`, { isBold: true, gap: 0 });
  write(`VAT: ${cleanText(document.vat, "TBC")}`, { isBold: true, gap: 0 });
  write(`Total: ${cleanText(document.total, "TBC")}`, { size: 13, isBold: true });

  return Buffer.from(await pdf.save());
}

export function simpleDocumentFilename(document: SimpleDocumentPdfInput, fallback = "nexa-document.pdf") {
  const name = cleanText(document.filename, fallback);
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}
