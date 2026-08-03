import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getRecordDocument, readRecordDocumentFile } from "@/lib/record-documents";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = readRecordDocumentFile(id);
  if (!payload) {
    const meta = getRecordDocument(id);
    return NextResponse.json({ error: meta ? "File missing on disk" : "Not found" }, { status: meta ? 404 : 404 });
  }

  return new NextResponse(payload.bytes, {
    status: 200,
    headers: {
      "Content-Type": payload.record.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${payload.record.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
