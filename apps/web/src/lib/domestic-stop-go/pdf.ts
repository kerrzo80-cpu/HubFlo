import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import { normalizeBusinessBranding } from "@/lib/branding";
import { getHubDetailState } from "@/lib/hub-detail-store";
import type { GeneratedRecord, WorkflowTemplate } from "@/lib/domestic-stop-go/types";

const ink = rgb(0.08, 0.12, 0.16);
const muted = rgb(0.35, 0.4, 0.45);
const brand = rgb(0.08, 0.5, 0.66);

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

function answerLabel(entry: unknown) {
  if (!entry || typeof entry !== "object") return "";
  const row = entry as { value?: unknown; answerStatus?: string; reason?: string };
  const status = row.answerStatus && row.answerStatus !== "answered" ? ` [${row.answerStatus}]` : "";
  const reason = row.reason ? ` — ${row.reason}` : "";
  return `${safeText(row.value)}${status}${reason}`;
}

export async function createDomesticWorkRecordPdf(input: {
  record: GeneratedRecord;
  template: WorkflowTemplate;
  jobRef: string;
  customer: string;
  site: string;
  sample?: boolean;
}) {
  const branding = normalizeBusinessBranding(
    (getHubDetailState().businessSettings || {}) as Record<string, unknown>,
  );
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 800;
  const pageWidth = 595.28;

  const footer = () => {
    const pages = pdf.getPages();
    pages.forEach((item, index) => {
      item.drawText(safeText(input.template.disclaimer), {
        x: 40,
        y: 28,
        size: 7,
        font: regular,
        color: muted,
      });
      item.drawText(`Page ${index + 1} of ${pages.length}  ·  ${input.record.recordNumber}  ·  ${input.record.verificationCode}`, {
        x: 40,
        y: 16,
        size: 8,
        font: regular,
        color: muted,
      });
    });
  };

  const ensure = (needed = 40) => {
    if (y < 60 + needed) {
      page = pdf.addPage([595.28, 841.89]);
      y = 800;
    }
  };

  const write = (text: string, options?: { size?: number; isBold?: boolean; color?: ReturnType<typeof rgb>; gap?: number }) => {
    const size = options?.size ?? 10;
    const font = options?.isBold ? bold : regular;
    const lines = wrapText(text, font, size, pageWidth - 80);
    lines.forEach((line) => {
      ensure(16);
      page.drawText(line, { x: 40, y, size, font, color: options?.color ?? ink });
      y -= size + 4;
    });
    y -= options?.gap ?? 2;
  };

  write(safeText(branding.tradingName || branding.companyName || "NeXa"), { size: 11, isBold: true, color: brand, gap: 2 });
  if (branding.address) write(branding.address, { size: 9, color: muted, gap: 0 });
  if (branding.phone || branding.contactEmail) {
    write([branding.phone, branding.contactEmail].filter(Boolean).join(" · "), { size: 9, color: muted, gap: 8 });
  }
  write(input.template.recordTitle, { size: 18, isBold: true, gap: 6 });
  if (input.template.costCentreCode === "DOM_GAS_LANDLORD_SAFETY") {
    write("Commonly referred to as a CP12. This NeXa record is not an official Gas Safe certificate.", { size: 8, color: muted, gap: 6 });
  }
  write(`Record ${input.record.recordNumber}  ·  Revision ${input.template.version}  ·  ${input.sample ? "SAMPLE" : "LOCKED"}`, { isBold: true });
  write(`Job ${input.jobRef}  ·  ${input.customer}`, { gap: 0 });
  write(input.site, { gap: 0 });
  write(`Generated ${input.record.generatedAt}  ·  Verify ${input.record.verificationCode}`, { size: 9, color: muted, gap: 10 });

  const snapshot = input.record.dataSnapshot as {
    answers?: Record<string, unknown>;
    signatures?: Array<{ role: string; signerName: string; status: string; refusalReason?: string }>;
  };
  const answers = snapshot.answers || {};
  const sections = new Map<string, Array<{ label: string; value: string; order: number }>>();
  for (const field of [...input.template.fields].sort((a, b) => a.pdfOrder - b.pdfOrder)) {
    const entry = answers[field.fieldKey];
    if (!entry) continue;
    const rows = sections.get(field.pdfSection) || [];
    rows.push({ label: field.label, value: answerLabel(entry) || "—", order: field.pdfOrder });
    sections.set(field.pdfSection, rows);
  }

  for (const [section, rows] of sections) {
    write(section, { size: 12, isBold: true, color: brand, gap: 4 });
    for (const row of rows) {
      write(`${row.label}: ${row.value}`, { size: 9, gap: 1 });
    }
    y -= 6;
  }

  const signatures = snapshot.signatures || [];
  if (signatures.length) {
    write("Acknowledgements", { size: 12, isBold: true, color: brand, gap: 4 });
    write("Signatures acknowledge receipt / information only. They do not waive statutory rights or engineer safety duties.", { size: 8, color: muted });
    signatures.forEach((item) => {
      write(`${item.role}: ${item.signerName || "—"} (${item.status})${item.refusalReason ? ` — ${item.refusalReason}` : ""}`, { size: 9 });
    });
  }

  write("Photographic evidence is stored against the job in Forms & Certificates. This PDF is generated from the locked snapshot, not live answers.", { size: 8, color: muted, gap: 8 });
  footer();
  return Buffer.from(await pdf.save());
}
