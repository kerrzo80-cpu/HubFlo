import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders, employeeHeaderName } from "@/lib/access";
import { sendEmailMessage } from "@/lib/email-integration-store";
import {
  createEmailAttachmentPdf,
  type BrandedCommercialPdfInput,
} from "@/lib/commercial-form-pdf";
import {
  simpleDocumentFilename,
} from "@/lib/simple-document-pdf";

type SendEmailBody = {
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  employeeId?: string;
  document?: BrandedCommercialPdfInput;
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
        filename: simpleDocumentFilename(body.document),
        content: await createEmailAttachmentPdf(body.document),
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
