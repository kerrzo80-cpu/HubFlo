import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type ReportPackRow = [string, string, string | number, string];

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
    target.drawText(safeText(`${input.companyName || "EWG"} · Reports board pack · Page ${pageNumber}`), {
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
  page.drawText(safeText(input.companyName || "Errol Watson Group"), {
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

export function downloadBlob(filename: string, blob: Blob) {
  if (typeof window === "undefined") return;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}
