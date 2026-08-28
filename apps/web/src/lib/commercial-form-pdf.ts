import { PageSizes, StandardFonts, rgb, type PDFPage } from "pdf-lib";

import { normalizeBusinessBranding } from "@/lib/branding";
import { formatCompanyRegistrationLine } from "@/lib/commercial-safeguards";
import {
  hexToPdfRgb,
  normalizeFormDocumentTemplate,
  resolveFormDocumentChrome,
  type FormDocumentLayout,
  type FormDocumentTemplate,
} from "@/lib/form-document-chrome";
import {
  embedCompanyLogo,
  formatPdfMoney,
  safePdfText,
  wrapPdfText,
} from "@/lib/pdf-branding-helpers";
import type { SimpleDocumentPdfInput } from "@/lib/simple-document-pdf";

const ink = rgb(0.08, 0.12, 0.16);
const muted = rgb(0.35, 0.4, 0.45);
const white = rgb(1, 1, 1);
const defaultBrand = rgb(0.08, 0.5, 0.66);

export type BrandedCommercialPdfInput = SimpleDocumentPdfInput & {
  formTemplate?: Partial<FormDocumentTemplate> & {
    id: string;
    layout: FormDocumentLayout;
    name: string;
    title: string;
  };
  businessSettings?: Record<string, unknown> | null;
  recipientAddress?: string;
  issueLine?: string;
  bankDetails?: string;
  subtotalAmount?: number;
  vatAmount?: number;
  totalAmount?: number;
};

function parseMoney(value: string | undefined, fallback = 0) {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultTemplateForLayout(layout: FormDocumentLayout): FormDocumentTemplate {
  return normalizeFormDocumentTemplate({
    id: `form-template-${layout}`,
    layout,
    name: layout,
    title: layout === "invoice" ? "Invoice" : layout === "quote" ? "Quotation" : "Document",
    intro: "",
    footer: "",
    terms: "",
    defaultAudience: "Client",
    presentation: "description",
    includeCostCentreBreakdown: false,
    includePnl: false,
    includeAcceptance: false,
    includeBankDetails: true,
    linkedCostCentreTypes: [],
    headerNote: "",
    showLogo: true,
    logoUrl: "",
    headerColor: "",
    showCompanyDetails: true,
    showVatCompanyNumbers: true,
    acceptanceLabel: "",
  });
}

export function shouldUseBrandedCommercialPdf(document: BrandedCommercialPdfInput) {
  return Boolean(document.formTemplate?.layout);
}

/** Branded quote / invoice PDF — matches Setup → Customise forms live proof. */
export async function createBrandedCommercialPdf(document: BrandedCommercialPdfInput) {
  const layout = document.formTemplate?.layout ?? "invoice";
  const template = normalizeFormDocumentTemplate(
    {
      ...defaultTemplateForLayout(layout),
      ...document.formTemplate,
      layout,
    },
    defaultTemplateForLayout(layout),
  );
  const business = normalizeBusinessBranding(document.businessSettings);
  const chrome = resolveFormDocumentChrome(template, business);
  const brandChannels = hexToPdfRgb(chrome.headerColor);
  const brand = brandChannels ? rgb(brandChannels.r, brandChannels.g, brandChannels.b) : defaultBrand;

  const pdf = await import("pdf-lib").then((mod) => mod.PDFDocument.create());
  pdf.setTitle(`${chrome.title} - ${safePdfText(document.reference)}`);
  pdf.setAuthor(chrome.tradingName);
  pdf.setCreator(chrome.tradingName);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = chrome.showLogo ? await embedCompanyLogo(pdf, chrome.logoUrl) : undefined;

  const margin = 42;
  const pageWidth = PageSizes.A4[0];
  const pageHeight = PageSizes.A4[1];
  const contentWidth = pageWidth - margin * 2;
  let page: PDFPage = pdf.addPage(PageSizes.A4);
  let y = pageHeight - margin;

  const subtotal = document.subtotalAmount ?? parseMoney(document.subtotal);
  const vat = document.vatAmount ?? parseMoney(document.vat);
  const total = document.totalAmount ?? parseMoney(document.total, subtotal + vat);

  function ensureSpace(needed: number) {
    if (y - needed < margin + 28) {
      page = pdf.addPage(PageSizes.A4);
      y = pageHeight - margin;
    }
  }

  function drawTextBlock(
    text: string,
    x: number,
    startY: number,
    options?: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; maxWidth?: number },
  ) {
    const size = options?.size ?? 10;
    const font = options?.font ?? regular;
    const color = options?.color ?? ink;
    const maxWidth = options?.maxWidth ?? contentWidth;
    const lines = wrapPdfText(text, font, size, maxWidth);
    lines.forEach((line, index) => {
      page.drawText(line, { x, y: startY - index * (size + 3), size, font, color });
    });
    return startY - lines.length * (size + 3);
  }

  // Masthead — logo left, company block right
  const mastheadTop = y;
  if (logo) {
    const size = logo.scaleToFit(96, 34);
    page.drawImage(logo, { x: margin, y: y - size.height, width: size.width, height: size.height });
  }
  const companyX = margin + (logo ? 110 : 0);
  let companyY = mastheadTop - 12;
  companyY = drawTextBlock(chrome.tradingName, companyX, companyY, { size: 11, font: bold, maxWidth: contentWidth - 110 });
  if (chrome.showCompanyDetails) {
    if (chrome.address) companyY = drawTextBlock(chrome.address, companyX, companyY - 2, { size: 8, color: muted, maxWidth: contentWidth - 110 });
    const contactLine = [chrome.phone, chrome.contactEmail].filter(Boolean).join(" · ");
    if (contactLine) companyY = drawTextBlock(contactLine, companyX, companyY - 1, { size: 8, color: muted, maxWidth: contentWidth - 110 });
    const registrationLine = formatCompanyRegistrationLine(chrome);
    if (chrome.showVatCompanyNumbers && registrationLine) {
      companyY = drawTextBlock(registrationLine, companyX, companyY - 1, {
        size: 8,
        color: muted,
        maxWidth: contentWidth - 110,
      });
    }
  }
  y = Math.min(y - (logo ? 40 : 0), companyY) - 14;

  // Title band
  const bandHeight = 54;
  ensureSpace(bandHeight + 20);
  page.drawRectangle({ x: margin, y: y - bandHeight, width: contentWidth, height: bandHeight, color: brand });
  const headerNote = safePdfText(chrome.headerNote || template.defaultAudience.toUpperCase());
  page.drawText(headerNote.toUpperCase(), { x: margin + 12, y: y - 16, size: 8, font: bold, color: white });
  page.drawText(safePdfText(chrome.title), { x: margin + 12, y: y - 34, size: 18, font: bold, color: white });
  page.drawText(safePdfText(document.reference), { x: margin + 12, y: y - 48, size: 9, font: regular, color: white });
  page.drawText(formatPdfMoney(total), {
    x: pageWidth - margin - 12 - bold.widthOfTextAtSize(formatPdfMoney(total), 16),
    y: y - 36,
    size: 16,
    font: bold,
    color: white,
  });
  y -= bandHeight + 16;

  // Prepared for / issue grid
  ensureSpace(52);
  page.drawText("PREPARED FOR", { x: margin, y, size: 7, font: bold, color: muted });
  y = drawTextBlock(safePdfText(document.recipient), margin, y - 10, { size: 11, font: bold });
  y = drawTextBlock(safePdfText(document.recipientAddress || "Address to be confirmed"), margin, y - 2, { size: 9, color: muted });
  const refX = margin + contentWidth * 0.55;
  let metaY = y + 28;
  page.drawText("Reference", { x: refX, y: metaY, size: 7, font: bold, color: muted });
  metaY = drawTextBlock(safePdfText(document.reference), refX, metaY - 10, { size: 10, font: bold, maxWidth: contentWidth * 0.4 });
  page.drawText("Issue details", { x: refX, y: metaY - 4, size: 7, font: bold, color: muted });
  drawTextBlock(safePdfText(document.issueLine || ""), refX, metaY - 14, { size: 9, color: muted, maxWidth: contentWidth * 0.4 });
  y -= 18;

  // Scope
  ensureSpace(40);
  y = drawTextBlock(safePdfText(document.subject), margin, y, { size: 13, font: bold });
  if (chrome.intro) y = drawTextBlock(chrome.intro, margin, y - 4, { size: 10, color: muted });
  y -= 8;

  // Table header
  ensureSpace(24);
  page.drawRectangle({ x: margin, y: y - 16, width: contentWidth, height: 18, color: rgb(0.93, 0.94, 0.95) });
  page.drawText("DESCRIPTION", { x: margin + 8, y: y - 12, size: 8, font: bold, color: muted });
  page.drawText("AMOUNT", {
    x: pageWidth - margin - 8 - bold.widthOfTextAtSize("AMOUNT", 8),
    y: y - 12,
    size: 8,
    font: bold,
    color: muted,
  });
  y -= 24;

  for (const row of document.rows ?? []) {
    ensureSpace(28);
    const description = safePdfText(row.description || "Item");
    const value = safePdfText(row.value);
    y = drawTextBlock(description, margin + 8, y, { size: 10, font: bold, maxWidth: contentWidth - 120 });
    if (row.detail) y = drawTextBlock(safePdfText(row.detail), margin + 8, y - 2, { size: 8, color: muted, maxWidth: contentWidth - 120 });
    if (value) {
      page.drawText(value, {
        x: pageWidth - margin - 8 - regular.widthOfTextAtSize(value, 10),
        y: y + 12,
        size: 10,
        font: regular,
        color: ink,
      });
    }
    y -= 8;
  }

  // Closing — terms + totals
  ensureSpace(90);
  y -= 6;
  const totalsX = margin + contentWidth * 0.58;
  page.drawText(template.layout === "invoice" ? "Payment terms" : "Terms and notes", {
    x: margin,
    y,
    size: 9,
    font: bold,
    color: ink,
  });
  let termsY = drawTextBlock(chrome.terms, margin, y - 12, { size: 9, color: muted, maxWidth: contentWidth * 0.52 });
  if (template.includeBankDetails && document.bankDetails) {
    termsY = drawTextBlock(`Payment details: ${document.bankDetails}`, margin, termsY - 4, {
      size: 9,
      color: muted,
      maxWidth: contentWidth * 0.52,
    });
  }
  if (chrome.footer) drawTextBlock(chrome.footer, margin, termsY - 4, { size: 8, color: muted, maxWidth: contentWidth * 0.52 });

  let totalsY = y;
  const totalRows = [
    ["Subtotal", formatPdfMoney(subtotal)],
    ["VAT", formatPdfMoney(vat)],
    ["Total", formatPdfMoney(total)],
  ] as const;
  for (const [label, amount] of totalRows) {
    page.drawText(label, { x: totalsX, y: totalsY, size: label === "Total" ? 11 : 9, font: label === "Total" ? bold : regular, color: ink });
    page.drawText(amount, {
      x: pageWidth - margin - 8 - bold.widthOfTextAtSize(amount, label === "Total" ? 11 : 9),
      y: totalsY,
      size: label === "Total" ? 11 : 9,
      font: label === "Total" ? bold : regular,
      color: ink,
    });
    totalsY -= label === "Total" ? 18 : 14;
  }

  return Buffer.from(await pdf.save());
}

export async function createEmailAttachmentPdf(document: BrandedCommercialPdfInput) {
  if (shouldUseBrandedCommercialPdf(document)) {
    return createBrandedCommercialPdf(document);
  }
  const { createSimpleDocumentPdf } = await import("@/lib/simple-document-pdf");
  return createSimpleDocumentPdf(document);
}
