import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { createEmailAttachmentPdf, type BrandedCommercialPdfInput } from "@/lib/commercial-form-pdf";
import {
  simpleDocumentFilename,
  type SimpleDocumentPdfInput,
} from "@/lib/simple-document-pdf";

export const runtime = "nodejs";

/** Download a simple commercial PDF without needing mailbox / SMTP. */
export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote && !access.showFinance && !access.canCustomize && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ document?: BrandedCommercialPdfInput }>(request);
  const document = body?.document;
  if (!document?.title && !document?.reference) {
    return NextResponse.json({ error: "Document title or reference is required." }, { status: 422 });
  }

  try {
    const pdf = await createEmailAttachmentPdf(document);
    const filename = simpleDocumentFilename(document);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to build PDF." },
      { status: 500 },
    );
  }
}
