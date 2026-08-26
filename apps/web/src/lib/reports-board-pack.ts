import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Lightweight job shape for board packs — avoid importing workflow-data (sqlite) into client. */
export type BoardPackJob = {
  id: string;
  ref: string;
  customer: string;
  status: string;
  value: number;
};

export type ReportPackRow = [string, string, string | number, string];

/** Default overhead allowance until business settings expose a configured value. */
export const DEFAULT_OVERHEAD_PERCENT = 12;

type HubInvoicePayment = {
  amount?: number;
  source?: string;
};

type HubInvoiceRow = {
  status?: string;
  paymentStatus?: string;
  chargeTotal?: number;
  paidAmount?: number;
  vatRate?: number;
  customer?: string;
  ref?: string;
  sourceId?: string;
  claimType?: string;
  payments?: HubInvoicePayment[];
};

export type ManagerBoardPackSnapshot = {
  invoices?: HubInvoiceRow[];
  jobs?: BoardPackJob[];
  businessSettings?: Record<string, unknown>;
  variationPortalPending?: number;
  variationPortalSell?: number;
  paymentSourceTotals?: Record<string, number>;
};

export type ManagerBoardPackResult = {
  asAt: string;
  overheadPercent: number;
  overheadLabel: string;
  title: string;
  rows: ReportPackRow[];
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function numericSetting(value: unknown, fallback: number) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveOverheadPercent(businessSettings?: Record<string, unknown>) {
  const raw =
    businessSettings?.overheadPercent ??
    businessSettings?.reportsOverheadPercent ??
    businessSettings?.overheadAllowancePercent;
  const parsed = numericSetting(raw, DEFAULT_OVERHEAD_PERCENT);
  return Math.max(0, Math.min(100, parsed));
}

function invoiceOwed(invoice: HubInvoiceRow) {
  if (invoice.status === "Cancelled") return 0;
  if (invoice.claimType === "valuation" || invoice.claimType === "credit-note") return 0;
  const charge = Number(invoice.chargeTotal) || 0;
  const vat = charge * ((Number(invoice.vatRate) || 0) / 100);
  const grand = charge + vat;
  const paidInFull = invoice.status === "Paid" || invoice.paymentStatus === "Paid";
  const paid = paidInFull ? grand : Number(invoice.paidAmount) || 0;
  return Math.max(0, grand - paid);
}

function sumPaymentsBySource(invoices: HubInvoiceRow[]) {
  const totals: Record<string, number> = {};
  for (const invoice of invoices) {
    if (invoice.status === "Cancelled") continue;
    for (const payment of invoice.payments ?? []) {
      const source = String(payment.source || "manual").trim() || "manual";
      totals[source] = (totals[source] ?? 0) + (Number(payment.amount) || 0);
    }
  }
  return totals;
}

/**
 * Pure executive board-pack builder. Pass a snapshot from the server loader
 * (`reports-board-pack-server.ts`) — do not import hub/sqlite here (client-safe).
 */
export function buildManagerBoardPackRows(options?: {
  asAt?: string;
  snapshot?: ManagerBoardPackSnapshot;
}): ManagerBoardPackResult {
  const asAt = options?.asAt ?? new Date().toISOString();
  const snapshot = options?.snapshot ?? {};
  const businessSettings = snapshot.businessSettings;
  const overheadPercent = resolveOverheadPercent(businessSettings);
  const overheadLabel = `${overheadPercent}% overhead allowance`;

  const invoices = snapshot.invoices ?? [];
  const jobs = snapshot.jobs ?? [];

  const openInvoices = invoices.filter(
    (invoice) =>
      invoice.status !== "Cancelled" &&
      invoice.status !== "Draft" &&
      invoice.claimType !== "valuation" &&
      invoice.claimType !== "credit-note",
  );
  let cashOwed = 0;
  let openInvoiceCharge = 0;
  let visibleRevenue = 0;
  for (const invoice of openInvoices) {
    const charge = Number(invoice.chargeTotal) || 0;
    openInvoiceCharge += charge;
    visibleRevenue += charge;
    cashOwed += invoiceOwed(invoice);
  }

  const readyJobs = jobs.filter((job) => job.status === "Ready to invoice");
  const readyValue = readyJobs.reduce((total, job) => total + (Number(job.value) || 0), 0);

  const wipJobs = jobs.filter((job) => !["Invoiced", "Closed", "Cancelled"].includes(job.status));
  let wipSell = 0;
  let wipUnbilled = 0;
  for (const job of wipJobs) {
    const billed = invoices
      .filter(
        (invoice) =>
          invoice.sourceId === job.id &&
          invoice.status !== "Cancelled" &&
          invoice.claimType !== "credit-note",
      )
      .reduce((total, invoice) => total + (Number(invoice.chargeTotal) || 0), 0);
    const sell = Number(job.value) || 0;
    wipSell += sell;
    wipUnbilled += Math.max(0, sell - billed);
  }

  const variationsAwaiting = snapshot.variationPortalPending ?? 0;
  const variationsSell = snapshot.variationPortalSell ?? 0;

  const paymentSources = snapshot.paymentSourceTotals ?? sumPaymentsBySource(invoices);
  const overheadAllowance = Math.round(visibleRevenue * (overheadPercent / 100));

  const rows: ReportPackRow[] = [
    ["Executive", "Cash owed", roundMoney(cashOwed), `${openInvoices.filter((invoice) => invoiceOwed(invoice) > 0).length} unpaid invoices`],
    [
      "Executive",
      "Ready to invoice jobs",
      readyJobs.length,
      `${roundMoney(readyValue)} contract value · ${readyJobs.length} job(s)`,
    ],
    [
      "Executive",
      "WIP unbilled",
      roundMoney(wipUnbilled),
      `${wipJobs.length} open jobs · ${roundMoney(wipSell)} sell`,
    ],
    [
      "Executive",
      "Open invoice charge",
      roundMoney(openInvoiceCharge),
      `${openInvoices.length} open invoices (ex VAT)`,
    ],
    ["Executive", "Overhead allowance", overheadAllowance, overheadLabel],
    [
      "Variations",
      "Awaiting client approval",
      variationsAwaiting,
      `${roundMoney(variationsSell)} sell value`,
    ],
    ...Object.entries(paymentSources).map(
      ([source, amount]): ReportPackRow => ["Cash reconcile", source, roundMoney(amount), "Payment source split"],
    ),
    ...readyJobs.slice(0, 20).map(
      (job): ReportPackRow => ["Ready to invoice", job.ref, Number(job.value) || 0, job.customer],
    ),
    ...openInvoices
      .filter((invoice) => invoiceOwed(invoice) > 0)
      .slice(0, 20)
      .map(
        (invoice): ReportPackRow => [
          "Invoices",
          String(invoice.ref || "Invoice"),
          roundMoney(invoiceOwed(invoice)),
          String(invoice.customer || ""),
        ],
      ),
  ];

  return {
    asAt,
    overheadPercent,
    overheadLabel,
    title: `Manager board pack · as at ${asAt}`,
    rows,
  };
}

export type ReportBoardPackInput = {
  title?: string;
  companyName?: string;
  dateLabel: string;
  generatedAt?: string;
  rows: ReportPackRow[];
};

const ink = rgb(0.08, 0.12, 0.16);
const muted = rgb(0.35, 0.4, 0.45);
const rule = rgb(0.82, 0.86, 0.9);
const brand = rgb(0.22, 0.63, 0.81);
const headerBg = rgb(0.94, 0.97, 0.99);

function safeText(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E£%°./,:()\-]/g, " ")
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

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Browser-friendly branded PDF board pack from the same rows as Reports CSV. */
export async function buildReportsBoardPackPdf(input: ReportBoardPackInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawFooter = (target: PDFPage, pageNumber: number) => {
    target.drawLine({
      start: { x: margin, y: 28 },
      end: { x: pageWidth - margin, y: 28 },
      thickness: 0.5,
      color: rule,
    });
    target.drawText(safeText(`${input.companyName || "Company"} · Reports board pack · Page ${pageNumber}`), {
      x: margin,
      y: 16,
      size: 8,
      font,
      color: muted,
    });
  };

  const ensureSpace = (needed: number) => {
    if (y - needed >= 42) return;
    drawFooter(page, pdf.getPageCount());
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  // Masthead
  page.drawRectangle({ x: 0, y: pageHeight - 78, width: pageWidth, height: 78, color: headerBg });
  page.drawRectangle({ x: 0, y: pageHeight - 78, width: 6, height: 78, color: brand });
  page.drawText(safeText(input.companyName || "Company"), {
    x: margin,
    y: pageHeight - 34,
    size: 11,
    font: bold,
    color: brand,
  });
  page.drawText(safeText(input.title || "Reports board pack"), {
    x: margin,
    y: pageHeight - 54,
    size: 18,
    font: bold,
    color: ink,
  });
  page.drawText(safeText(`${input.dateLabel} · Generated ${input.generatedAt || new Date().toLocaleString("en-GB")}`), {
    x: margin,
    y: pageHeight - 70,
    size: 9,
    font,
    color: muted,
  });
  y = pageHeight - 100;

  const colSection = margin;
  const colMetric = margin + 90;
  const colValue = margin + 280;
  const colDetail = margin + 370;
  const detailWidth = pageWidth - margin - colDetail;

  const sections = new Map<string, ReportPackRow[]>();
  for (const row of input.rows) {
    const section = safeText(row[0]) || "General";
    const list = sections.get(section) ?? [];
    list.push(row);
    sections.set(section, list);
  }

  for (const [section, rows] of sections) {
    ensureSpace(36);
    page.drawText(section, { x: margin, y, size: 12, font: bold, color: ink });
    y -= 8;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 1,
      color: brand,
    });
    y -= 16;

    // Column headers
    ensureSpace(18);
    page.drawText("Metric", { x: colMetric, y, size: 8, font: bold, color: muted });
    page.drawText("Value", { x: colValue, y, size: 8, font: bold, color: muted });
    page.drawText("Detail", { x: colDetail, y, size: 8, font: bold, color: muted });
    y -= 12;

    for (const row of rows) {
      const metricLines = wrapText(String(row[1]), font, 9, colValue - colMetric - 8);
      const valueLines = wrapText(String(row[2]), bold, 9, colDetail - colValue - 8);
      const detailLines = wrapText(String(row[3]), font, 8, detailWidth);
      const lineCount = Math.max(metricLines.length, valueLines.length, detailLines.length, 1);
      ensureSpace(lineCount * 11 + 6);

      for (let i = 0; i < lineCount; i++) {
        if (metricLines[i]) page.drawText(metricLines[i]!, { x: colMetric, y, size: 9, font, color: ink });
        if (valueLines[i]) page.drawText(valueLines[i]!, { x: colValue, y, size: 9, font: bold, color: ink });
        if (detailLines[i]) page.drawText(detailLines[i]!, { x: colDetail, y, size: 8, font, color: muted });
        // Keep section tag only on first line of first row visually quiet
        if (i === 0 && rows.indexOf(row) === 0) {
          void colSection;
        }
        y -= 11;
      }
      y -= 4;
    }
    y -= 10;
  }

  drawFooter(page, pdf.getPageCount());
  return pdf.save();
}

/**
 * Excel-compatible SpreadsheetML workbook (.xls that Excel/Numbers open).
 * One worksheet per report section — no extra npm dependency.
 */
export function buildReportsExcelXml(input: ReportBoardPackInput): string {
  const sections = new Map<string, ReportPackRow[]>();
  for (const row of input.rows) {
    const section = safeText(row[0]) || "General";
    const list = sections.get(section) ?? [];
    list.push(row);
    sections.set(section, list);
  }

  const worksheets = [...sections.entries()].map(([section, rows], index) => {
    const name = safeText(section).slice(0, 31) || `Sheet${index + 1}`;
    const body = [
      `<Row><Cell ss:StyleID="header"><Data ss:Type="String">Metric</Data></Cell><Cell ss:StyleID="header"><Data ss:Type="String">Value</Data></Cell><Cell ss:StyleID="header"><Data ss:Type="String">Detail</Data></Cell></Row>`,
      ...rows.map(
        (row) =>
          `<Row><Cell><Data ss:Type="String">${xmlEscape(row[1])}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(row[2])}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(row[3])}</Data></Cell></Row>`,
      ),
    ].join("");
    return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${body}</Table></Worksheet>`;
  });

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header"><Font ss:Bold="1"/><Interior ss:Color="#E8F4FA" ss:Pattern="Solid"/></Style>
 </Styles>
 ${worksheets.join("\n")}
</Workbook>`;
}

export { downloadBlob } from "@/lib/download-blob";
