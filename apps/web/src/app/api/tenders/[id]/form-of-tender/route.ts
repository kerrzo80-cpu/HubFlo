import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getTender } from "@/lib/tenders-data";
import { createFormOfTenderPdf, formOfTenderFilename } from "@/lib/tender-form-of-tender-pdf";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const tender = getTender(id);
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const businessName = request.nextUrl.searchParams.get("businessName") || undefined;
  const signatoryName = request.nextUrl.searchParams.get("signatoryName") || undefined;
  const signatoryTitle = request.nextUrl.searchParams.get("signatoryTitle") || undefined;

  const pdf = await createFormOfTenderPdf({
    tender,
    businessName,
    signatoryName,
    signatoryTitle,
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${formOfTenderFilename(tender)}"`,
    },
  });
}
