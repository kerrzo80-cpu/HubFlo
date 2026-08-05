import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  dayworkDraftFromRecord,
  dayworkRecordFromDraft,
  isDayworkSubmittedToCore,
  isValidDayworkClientEmail,
  parseDayworkLineItems,
  validateDayworkSheetDraft,
  type DayworkAccountRecord,
  type DayworkSheetDraft,
} from "@/lib/daywork-account-form";
import {
  buildDayworkAccountRecordFromEvidence,
  ensureDayworkVariationCostCentre,
  listDayworkSheetsForJob,
  reconcileDayworkVariationsFromEvidence,
  saveDayworkSheetToHub,
} from "@/lib/engineer-flow";
import { getHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { type DayworkSheetSnapshot } from "@/lib/daywork-account-form";
import { findDayworkSheetForJob, getDayworkSheetFromStore, listDayworkSheetsFromStore } from "@/lib/daywork-sheets-store";
import { createDayworkAccountPdf, dayworkPdfFilename } from "@/lib/daywork-pdf";
import { sendEmailMessage } from "@/lib/email-integration-store";
import { recordDayworkWriteAttempt } from "@/lib/daywork-write-log";
import { summarizeDayworkApiPayload } from "@/lib/daywork-poll-strip";
import { toUkDateDisplay } from "@/lib/uk-date";
import { getJobs } from "@/lib/workflow-data";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type DayworkBody = {
  action?: string;
  createdBy?: string;
  costCentreId?: string;
  clientEmail?: string;
  record?: DayworkAccountRecord;
  draft?: DayworkSheetDraft;
};

/** Fetch the latest Daywork Account sheet for a job (forces reconcile from Field snapshot). */
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

  try {
    reconcileDayworkVariationsFromEvidence();
  } catch {
    // Best-effort.
  }

  const url = new URL(request.url);
  const costCentreId =
    url.searchParams.get("costCentreId")?.trim() || ensureDayworkVariationCostCentre(jobId);
  const includeSignatures = url.searchParams.get("includeSignatures") === "1";
  const hubState = getHubDetailState() as HubDetailState & {
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
    flowStepEvidence?: Record<string, unknown>;
    jobDeliveryEvents?: unknown[];
  };
  const sheet =
    findDayworkSheetForJob(hubState.dayworkSheets, jobId, costCentreId) ||
    listDayworkSheetsForJob(jobId).find((item) => item.costCentreId === costCentreId) ||
    listDayworkSheetsForJob(jobId)[0] ||
    null;
  const record = sheet || buildDayworkAccountRecordFromEvidence(jobId, costCentreId);

  const payload = {
    ok: true,
    jobId,
    jobRef: job.ref,
    costCentreId,
    record,
    sheet,
    dayworkSheets: hubState.dayworkSheets ?? {},
    flowStepEvidence: hubState.flowStepEvidence ?? {},
    jobDeliveryEvents: hubState.jobDeliveryEvents ?? [],
  };

  if (includeSignatures) {
    return NextResponse.json(payload);
  }

  const light = summarizeDayworkApiPayload({
    record: record as DayworkAccountRecord | null,
    sheet: sheet as DayworkAccountRecord | null,
    dayworkSheets: hubState.dayworkSheets as Record<string, DayworkAccountRecord> | undefined,
    flowStepEvidence: hubState.flowStepEvidence,
    jobDeliveryEvents: hubState.jobDeliveryEvents,
  });

  return NextResponse.json({
    ...payload,
    ...light,
  });
}

/** Core can ingest / save a full Daywork Account sheet (no Field required). */
export async function POST(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await params;
  const job = getJobs().find((item) => item.id === jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  let body: DayworkBody = {};
  try {
    body = (await request.json()) as DayworkBody;
  } catch {
    body = {};
  }

  if (body.action === "send_copy") {
    const costCentreId = body.costCentreId?.trim() || ensureDayworkVariationCostCentre(jobId);
    const existing =
      listDayworkSheetsForJob(jobId).find((sheet) => sheet.costCentreId === costCentreId) ||
      getDayworkSheetFromStore(jobId, costCentreId) ||
      buildDayworkAccountRecordFromEvidence(jobId, costCentreId);
    if (!existing || !isDayworkSubmittedToCore(existing)) {
      return NextResponse.json(
        { error: "Save the Daywork with both signatures before emailing a client copy." },
        { status: 400 },
      );
    }
    const clientEmail = String(body.clientEmail || existing.clientEmail || "").trim();
    if (!isValidDayworkClientEmail(clientEmail)) {
      return NextResponse.json(
        { error: "Enter a valid client email address to send the Daywork copy." },
        { status: 400 },
      );
    }
    if (clientEmail !== String(existing.clientEmail || "").trim()) {
      try {
        saveDayworkSheetToHub({
          jobId,
          jobRef: job.ref,
          costCentreId,
          engineerName: body.createdBy || existing.labourName || "Core",
          record: {
            ...existing,
            clientEmail,
            populatedFrom: existing.populatedFrom || "core",
          },
        });
      } catch {
        // Still attempt send.
      }
    }
    try {
      const pdfBytes = await createDayworkAccountPdf({
        customer: job.customer || existing.clientSignerName || "Client",
        site: job.site || "",
        engineer: existing.labourName || existing.plumberSignerName || "Field",
        jobRef: job.ref,
        contract: job.site,
        record: existing,
        variant: "client",
      });
      const filename = dayworkPdfFilename(existing, job.ref, "client");
      const delivery = await sendEmailMessage({
        to: clientEmail,
        subject: `Daywork Account copy — ${job.ref}`,
        text: [
          `Hello${existing.clientSignerName ? ` ${existing.clientSignerName}` : ""},`,
          "",
          `Please find attached a copy of the Daywork Account for job ${job.ref}.`,
          "",
          "This copy shows the hours and materials recorded on site (no pricing).",
          `Operative: ${existing.labourName || existing.plumberSignerName || "Field"}`,
          `Week ending: ${existing.weekEnding || "—"}`,
          `Total hours: ${String(existing.labourHours || "").trim() || "as recorded"}`,
          "",
          "Kind regards,",
          "Errol Watson Group",
        ].join("\n"),
        attachments: [{ filename, content: pdfBytes, contentType: "application/pdf" }],
      });
      return NextResponse.json({
        ok: true,
        emailed: true,
        clientEmail,
        delivery,
        record: { ...existing, clientEmail },
        sheets: listDayworkSheetsForJob(jobId),
      });
    } catch (sendError) {
      return NextResponse.json(
        {
          error:
            sendError instanceof Error
              ? sendError.message
              : "Could not email Daywork copy — check email / SMTP settings.",
        },
        { status: 502 },
      );
    }
  }

  if (body.action !== "save") {
    return NextResponse.json({ error: "Unsupported action. Use action: save or send_copy." }, { status: 400 });
  }

  const costCentreId =
    body.costCentreId?.trim() || ensureDayworkVariationCostCentre(jobId);

  let record = body.record;
  if (!record && body.draft) {
    const validationError = validateDayworkSheetDraft(body.draft);
    if (validationError) {
      recordDayworkWriteAttempt({
        at: new Date().toISOString(),
        source: "core-daywork",
        jobId,
        costCentreId,
        ok: false,
        error: validationError,
      });
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    record = dayworkRecordFromDraft(body.draft, "core");
  }
  if (!record) {
    recordDayworkWriteAttempt({
      at: new Date().toISOString(),
      source: "core-daywork",
      jobId,
      costCentreId,
      ok: false,
      error: "Daywork record is required.",
    });
    return NextResponse.json({ error: "Daywork record is required." }, { status: 400 });
  }
  if (record.weekEnding) {
    record = { ...record, weekEnding: toUkDateDisplay(record.weekEnding), populatedFrom: "core" };
  } else {
    record = { ...record, populatedFrom: "core" };
  }

  const draftCheck = dayworkDraftFromRecord(record);
  const validationError = validateDayworkSheetDraft(draftCheck);
  if (validationError) {
    recordDayworkWriteAttempt({
      at: new Date().toISOString(),
      source: "core-daywork",
      jobId,
      costCentreId,
      ok: false,
      error: validationError,
      materialsCount: parseDayworkLineItems(record.materialsJson).length,
      hasClientName: Boolean(record.clientSignerName?.trim()),
      hasSignatures: Boolean(record.plumberSignature?.trim() && record.clientSignature?.trim()),
    });
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    saveDayworkSheetToHub({
      jobId,
      jobRef: job.ref,
      costCentreId,
      engineerName: body.createdBy || record.labourName || record.plumberSignerName || "Core",
      record,
    });
  } catch (saveError) {
    const message = saveError instanceof Error ? saveError.message : "Could not save Daywork sheet.";
    recordDayworkWriteAttempt({
      at: new Date().toISOString(),
      source: "core-daywork",
      jobId,
      costCentreId,
      ok: false,
      error: message,
      materialsCount: parseDayworkLineItems(record.materialsJson).length,
      hasClientName: Boolean(record.clientSignerName?.trim()),
      hasSignatures: Boolean(record.plumberSignature?.trim() && record.clientSignature?.trim()),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const verified =
    getDayworkSheetFromStore(jobId, costCentreId) ||
    listDayworkSheetsFromStore(jobId).find((sheet) => sheet.costCentreId === costCentreId) ||
    null;
  const materialsCount = parseDayworkLineItems(verified?.materialsJson || record.materialsJson).length;
  const hasSignatures = Boolean(
    String(verified?.plumberSignature || "").trim() && String(verified?.clientSignature || "").trim(),
  );
  const hasClientName = Boolean(String(verified?.clientSignerName || record.clientSignerName || "").trim());

  if (!verified || !hasSignatures) {
    const error = "Daywork save did not persist signatures to the live store.";
    recordDayworkWriteAttempt({
      at: new Date().toISOString(),
      source: "core-daywork",
      jobId,
      costCentreId,
      ok: false,
      error,
      materialsCount,
      hasClientName,
      hasSignatures,
    });
    return NextResponse.json({ error, persisted: false }, { status: 500 });
  }

  recordDayworkWriteAttempt({
    at: new Date().toISOString(),
    source: "core-daywork",
    jobId,
    costCentreId,
    ok: true,
    materialsCount,
    hasClientName,
    hasSignatures,
  });

  const hubState = getHubDetailState() as HubDetailState & {
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
  };

  return NextResponse.json({
    ok: true,
    jobId,
    costCentreId,
    record: verified,
    sheet: verified,
    persisted: true,
    materialsCount,
    hasClientName,
    hasSignatures,
    storeSheetCount: listDayworkSheetsFromStore().length,
    dayworkSheets: hubState.dayworkSheets ?? {},
  });
}
