import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders, employeeHeaderName } from "@/lib/access";
import { sendEmailMessage } from "@/lib/email-integration-store";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type DocumentRow = {
  description?: string;
  detail?: string;
  value?: string;
};

type SendEmailBody = {
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  employeeId?: string;
  document?: {
    filename?: string;
    title?: string;
    businessName?: string;
    reference?: string;
    recipient?: string;
    subject?: string;
    rows?: DocumentRow[];
    subtotal?: string;
    vat?: string;
    total?: string;
  };
  /** Extra PDFs (e.g. signed Daywork Account sheets) as base64. */
  extraAttachments?: Array<{
    filename?: string;
    contentBase64?: string;
    contentType?: string;
  }>;
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

async function createDocumentPdf(document: NonNullable<SendEmailBody["document"]>) {
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

  write(cleanText(document.businessName, "Blake"), { size: 11, isBold: true, color: rgb(0.08, 0.45, 0.62), gap: 10 });
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

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote && !access.showFinance && !access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as SendEmailBody | null;
  if (!body?.to || !body.subject || !body.text) {
    return NextResponse.json({ error: "Recipient, subject and message are required." }, { status: 422 });
  }

  const headerEmployeeId = request.headers.get(employeeHeaderName)?.trim() || "";
  const employeeId = cleanText(body.employeeId) || headerEmployeeId;

  try {
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    if (body.document) {
      attachments.push({
        filename: cleanText(body.document.filename, "nexa-document.pdf"),
        content: await createDocumentPdf(body.document),
        contentType: "application/pdf",
      });
    }
    for (const extra of body.extraAttachments ?? []) {
      const filename = cleanText(extra.filename, "attachment.pdf");
      const contentBase64 = cleanText(extra.contentBase64);
      if (!contentBase64) continue;
      try {
        attachments.push({
          filename,
          content: Buffer.from(contentBase64, "base64"),
          contentType: cleanText(extra.contentType, "application/pdf"),
        });
      } catch {
        // Skip malformed attachments.
      }
    }
    const delivery = await sendEmailMessage({
      to: body.to,
      cc: body.cc,
      subject: body.subject,
      text: body.text,
      employeeId: employeeId || undefined,
      attachments: attachments.length ? attachments : undefined,
    });
    return NextResponse.json({ ok: true, delivery });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to send email.",
      },
      { status: 422 },
    );
  }
}
