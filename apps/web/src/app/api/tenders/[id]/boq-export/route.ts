import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getTender } from "@/lib/tenders-data";
import {
  buildTenderBoqXlsxBuffer,
  rowsToDelimitedText,
  tenderBoqExportFilename,
  tenderBoqLinesToRows,
} from "@/lib/tenders-xlsx";

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
  if (!tender.boqLines.length) {
    return NextResponse.json({ error: "No BoQ lines to export." }, { status: 400 });
  }

  const format = (request.nextUrl.searchParams.get("format") || "xlsx").trim().toLowerCase();
  const sheetKey = request.nextUrl.searchParams.get("sheet")?.trim() || null;
  const scope = (request.nextUrl.searchParams.get("scope") || "all").trim().toLowerCase();
  const activeOnly = scope === "active" || scope === "sheet";
  const exportSheet = activeOnly ? sheetKey : null;

  if (format === "csv") {
    const lines = exportSheet
      ? tender.boqLines.filter((line) => (line.sheet || "").trim() === exportSheet)
      : tender.boqLines;
    const csv = rowsToDelimitedText(tenderBoqLinesToRows(lines.length ? lines : tender.boqLines));
    const safe = (tender.name || "tender").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "tender";
    const sheetSuffix = exportSheet
      ? `_${exportSheet.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`
      : "";
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="BoQ_${safe}${sheetSuffix}.csv"`,
      },
    });
  }

  const buffer = buildTenderBoqXlsxBuffer(tender.boqLines, {
    sheetKey: exportSheet,
    title: tender.boqTitle || tender.name || "BoQ",
  });
  const filename = tenderBoqExportFilename(tender.name, exportSheet);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
