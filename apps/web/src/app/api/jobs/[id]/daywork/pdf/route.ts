import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { buildDayworkAccountRecordFromEvidence, listDayworkSheetsForJob } from "@/lib/engineer-flow";
import { createDayworkAccountPdf, dayworkPdfFilename } from "@/lib/daywork-pdf";
import { getJobs } from "@/lib/workflow-data";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Generate Daywork Account PDF(s) for a job — used when submitting valuations. */
export async function GET(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await params;
  const job = getJobs().find((item) => item.id === jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const costCentreId = url.searchParams.get("costCentreId")?.trim();
  let sheets = listDayworkSheetsForJob(jobId);
  if (costCentreId) {
    sheets = sheets.filter((sheet) => sheet.costCentreId === costCentreId);
  }
  if (!sheets.length) {
    const fallbackId = costCentreId || `${jobId}-daywork-account`;
    const record = buildDayworkAccountRecordFromEvidence(jobId, fallbackId);
    if (record) {
      sheets = [
        {
          ...record,
          jobId,
          jobRef: job.ref,
          costCentreId: fallbackId,
          updatedAt: record.completedAt || new Date().toISOString(),
        },
      ];
    }
  }

  if (!sheets.length) {
    return NextResponse.json({ error: "No Daywork Account sheet found for this job." }, { status: 404 });
  }

  const attachments = [];
  for (const sheet of sheets) {
    const bytes = await createDayworkAccountPdf({
      customer: job.customer || "Client",
      site: job.site || "",
      engineer: sheet.labourName || sheet.plumberSignerName || "Field",
      jobRef: job.ref,
      contract: job.site,
      record: sheet,
    });
    attachments.push({
      filename: dayworkPdfFilename(sheet, job.ref),
      contentType: "application/pdf",
      contentBase64: bytes.toString("base64"),
      costCentreId: sheet.costCentreId,
      plumberSignerName: sheet.plumberSignerName || "",
      clientSignerName: sheet.clientSignerName || "",
    });
  }

  return NextResponse.json({ ok: true, jobId, attachments });
}
