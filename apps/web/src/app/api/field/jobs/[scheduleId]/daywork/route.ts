import { NextResponse } from "next/server";

import {
  dayworkDraftFromRecord,
  dayworkRecordFromDraft,
  isDayworkSubmittedToCore,
  isValidDayworkClientEmail,
  parseDayworkLineItems,
  stripDayworkOfficePricing,
  validateDayworkSheetDraft,
  type DayworkAccountRecord,
  type DayworkSheetDraft,
  type DayworkSheetSnapshot,
} from "@/lib/daywork-account-form";
import { getEngineerScheduleItem, type EngineerRequirement } from "@/lib/engineer-data";
import {
  buildDayworkAccountRecordFromEvidence,
  DAYWORK_COST_CENTRE_NAME,
  DAYWORK_COST_CENTRE_TEMPLATE,
  createAdditionalDayworkCostCentre,
  discardUnsignedDayworkSheet,
  ensureDayworkVariationCostCentre,
  listDayworkSheetsForJob,
  requirementsFromFlowTemplate,
  saveDayworkSheetToHub,
} from "@/lib/engineer-flow";
import { activateDayworkWorkflow, clearDayworkWorkflowMode } from "@/lib/engineer-workflow-store";
import { getDayworkSheetFromStore, listDayworkSheetsFromStore } from "@/lib/daywork-sheets-store";
import { createDayworkAccountPdf, dayworkPdfFilename } from "@/lib/daywork-pdf";
import { sendEmailMessage } from "@/lib/email-integration-store";
import { recordDayworkWriteAttempt } from "@/lib/daywork-write-log";
import { getJobs } from "@/lib/workflow-data";
import { toUkDateDisplay } from "@/lib/uk-date";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string }> };

type DayworkBody = {
  action?: string;
  createdBy?: string;
  costCentreId?: string;
  clientEmail?: string;
  record?: DayworkAccountRecord;
  draft?: DayworkSheetDraft;
};

function dayworkRequirements(jobId: string, costCentreId: string): EngineerRequirement[] {
  return requirementsFromFlowTemplate({
    jobId,
    costCentreId,
    costCentreName: DAYWORK_COST_CENTRE_NAME,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
  }) as EngineerRequirement[];
}

function fieldSafeRecord(record: DayworkAccountRecord | null | undefined) {
  if (!record) return null;
  return stripDayworkOfficePricing(record);
}

function fieldSafeSheets(sheets: DayworkSheetSnapshot[]) {
  return sheets.map((sheet) => stripDayworkOfficePricing(sheet));
}

function resolveDayworkRecord(jobId: string, costCentreId: string): DayworkAccountRecord | null {
  const fromList = listDayworkSheetsForJob(jobId).find((sheet) => sheet.costCentreId === costCentreId);
  if (fromList) return fromList;
  try {
    const fromStore = getDayworkSheetFromStore(jobId, costCentreId);
    if (fromStore) return fromStore;
  } catch {
    // Best-effort — fall through to evidence rebuild.
  }
  return buildDayworkAccountRecordFromEvidence(jobId, costCentreId);
}

/** Ensure / clear / save Daywork Account sheet for a Field schedule. */
export async function POST(request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const schedule = getEngineerScheduleItem(scheduleId);
  if (!schedule?.jobId) {
    return NextResponse.json({ error: "Schedule not found." }, { status: 404 });
  }

  let body: DayworkBody = {};
  try {
    body = (await request.json()) as DayworkBody;
  } catch {
    body = {};
  }

  if (body.action === "clear") {
    const workflow = clearDayworkWorkflowMode(scheduleId);
    return NextResponse.json({
      scheduleId,
      checklistMode: "job",
      requirements: workflow.requirements ?? [],
      sheets: fieldSafeSheets(listDayworkSheetsForJob(schedule.jobId)),
    });
  }

  if (body.action === "discard") {
    const costCentreId = body.costCentreId?.trim();
    if (!costCentreId) {
      return NextResponse.json({ error: "costCentreId is required to discard a Daywork." }, { status: 400 });
    }
    const result = discardUnsignedDayworkSheet({
      jobId: schedule.jobId,
      costCentreId,
    });
    if (!result.discarded) {
      return NextResponse.json({ error: result.reason || "Could not discard Daywork." }, { status: 409 });
    }
    const workflow = clearDayworkWorkflowMode(scheduleId);
    recordDayworkWriteAttempt({
      at: new Date().toISOString(),
      source: "field-daywork",
      scheduleId,
      jobId: schedule.jobId,
      costCentreId,
      ok: true,
      error: "discarded-unsigned",
    });
    return NextResponse.json({
      scheduleId,
      jobId: schedule.jobId,
      discarded: true,
      costCentreId,
      checklistMode: "job",
      requirements: workflow.requirements ?? [],
      sheets: fieldSafeSheets(listDayworkSheetsForJob(schedule.jobId)),
    });
  }

  if (body.action === "send_copy") {
    const costCentreId =
      body.costCentreId?.trim() || ensureDayworkVariationCostCentre(schedule.jobId);
    const coreJob = getJobs().find((job) => job.id === schedule.jobId);
    const existing =
      resolveDayworkRecord(schedule.jobId, costCentreId) ||
      getDayworkSheetFromStore(schedule.jobId, costCentreId);
    if (!existing || !isDayworkSubmittedToCore(existing)) {
      return NextResponse.json(
        { error: "Save and finish the Daywork (both signatures) before emailing a client copy." },
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

    // Persist email on the sheet so Field can resend later.
    if (clientEmail !== String(existing.clientEmail || "").trim()) {
      try {
        saveDayworkSheetToHub({
          jobId: schedule.jobId,
          jobRef: coreJob?.ref || schedule.jobRef,
          costCentreId,
          engineerName: body.createdBy || schedule.engineerName,
          record: { ...existing, clientEmail, populatedFrom: existing.populatedFrom || "engineer-app" },
        });
      } catch {
        // Still attempt send even if email persistence fails.
      }
    }

    const jobRef = coreJob?.ref || schedule.jobRef || schedule.jobId;
    try {
      const pdfBytes = await createDayworkAccountPdf({
        customer: coreJob?.customer || existing.clientSignerName || "Client",
        site: coreJob?.site || schedule.address || "",
        engineer: existing.labourName || existing.plumberSignerName || schedule.engineerName || "Field",
        jobRef,
        contract: coreJob?.site || schedule.address || "",
        record: existing,
        variant: "client",
      });
      const filename = dayworkPdfFilename(existing, jobRef, "client");
      const hours = String(existing.labourHours || "").trim() || "as recorded";
      const delivery = await sendEmailMessage({
        to: clientEmail,
        subject: `Daywork Account copy — ${jobRef}`,
        text: [
          `Hello${existing.clientSignerName ? ` ${existing.clientSignerName}` : ""},`,
          "",
          `Please find attached a copy of the Daywork Account for job ${jobRef}.`,
          "",
          "This copy shows the hours and materials recorded on site (no pricing).",
          `Operative: ${existing.labourName || existing.plumberSignerName || schedule.engineerName || "Field"}`,
          `Week ending: ${existing.weekEnding || "—"}`,
          `Total hours: ${hours}`,
          "",
          "Kind regards,",
          "Errol Watson Group",
        ].join("\n"),
        attachments: [
          {
            filename,
            content: pdfBytes,
            contentType: "application/pdf",
          },
        ],
      });
      recordDayworkWriteAttempt({
        at: new Date().toISOString(),
        source: "field-daywork",
        scheduleId,
        jobId: schedule.jobId,
        costCentreId,
        ok: true,
        error: `client-copy-emailed:${clientEmail}`,
      });
      return NextResponse.json({
        scheduleId,
        jobId: schedule.jobId,
        costCentreId,
        emailed: true,
        clientEmail,
        delivery,
        record: fieldSafeRecord({
          ...existing,
          clientEmail,
        }),
        sheets: fieldSafeSheets(listDayworkSheetsForJob(schedule.jobId)),
      });
    } catch (sendError) {
      const message =
        sendError instanceof Error
          ? sendError.message
          : "Could not email Daywork copy — check Core email / SMTP settings.";
      recordDayworkWriteAttempt({
        at: new Date().toISOString(),
        source: "field-daywork",
        scheduleId,
        jobId: schedule.jobId,
        costCentreId,
        ok: false,
        error: message,
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const costCentreId =
    body.costCentreId?.trim() ||
    (body.action === "new"
      ? createAdditionalDayworkCostCentre(schedule.jobId)
      : ensureDayworkVariationCostCentre(schedule.jobId));
  const coreJob = getJobs().find((job) => job.id === schedule.jobId);

  if (body.action === "new") {
    const requirements = dayworkRequirements(schedule.jobId, costCentreId);
    const workflow = activateDayworkWorkflow(scheduleId, costCentreId, requirements);
    recordDayworkWriteAttempt({
      at: new Date().toISOString(),
      source: "field-daywork",
      scheduleId,
      jobId: schedule.jobId,
      costCentreId,
      ok: true,
      error: "new-sheet-opened",
    });
    return NextResponse.json({
      scheduleId,
      jobId: schedule.jobId,
      jobRef: coreJob?.ref || schedule.jobRef,
      costCentreId,
      costCentreName: DAYWORK_COST_CENTRE_NAME,
      templateName: DAYWORK_COST_CENTRE_TEMPLATE,
      checklistMode: "daywork",
      record: null,
      sheets: fieldSafeSheets(listDayworkSheetsForJob(schedule.jobId)),
      requirements: workflow.requirements ?? requirements,
    });
  }

  if (body.action === "save") {
    // Log immediately so /api/health.lastWrite proves the Field POST reached the server
    // (even when validation later rejects the payload).
    recordDayworkWriteAttempt({
      at: new Date().toISOString(),
      source: "field-daywork",
      scheduleId,
      jobId: schedule.jobId,
      costCentreId,
      ok: false,
      error: "save-received",
    });

    const existingSubmitted =
      resolveDayworkRecord(schedule.jobId, costCentreId) ||
      getDayworkSheetFromStore(schedule.jobId, costCentreId);
    if (isDayworkSubmittedToCore(existingSubmitted)) {
      recordDayworkWriteAttempt({
        at: new Date().toISOString(),
        source: "field-daywork",
        scheduleId,
        jobId: schedule.jobId,
        costCentreId,
        ok: false,
        error: "locked-already-submitted",
        hasSignatures: true,
      });
      return NextResponse.json(
        {
          error:
            "This Daywork is locked — already submitted to Core. Only office can edit it in Core.",
          locked: true,
          persisted: false,
          record: fieldSafeRecord(existingSubmitted),
          sheets: fieldSafeSheets(listDayworkSheetsForJob(schedule.jobId)),
        },
        { status: 409 },
      );
    }

    let record = body.record;
    if (!record && body.draft) {
      const validationError = validateDayworkSheetDraft(body.draft);
      if (validationError) {
        recordDayworkWriteAttempt({
          at: new Date().toISOString(),
          source: "field-daywork",
          scheduleId,
          ok: false,
          error: validationError,
        });
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
      record = dayworkRecordFromDraft(body.draft, "engineer-app");
    }
    if (!record) {
      recordDayworkWriteAttempt({
        at: new Date().toISOString(),
        source: "field-daywork",
        scheduleId,
        ok: false,
        error: "Daywork record is required.",
      });
      return NextResponse.json({ error: "Daywork record is required." }, { status: 400 });
    }
    if (record.weekEnding) {
      record = { ...record, weekEnding: toUkDateDisplay(record.weekEnding) };
    }
    const draftCheck = dayworkDraftFromRecord(record);
    const validationError = validateDayworkSheetDraft(draftCheck);
    if (validationError) {
      recordDayworkWriteAttempt({
        at: new Date().toISOString(),
        source: "field-daywork",
        scheduleId,
        jobId: schedule.jobId,
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
        jobId: schedule.jobId,
        jobRef: coreJob?.ref || schedule.jobRef,
        costCentreId,
        engineerName: body.createdBy || schedule.engineerName,
        record,
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Could not save Daywork sheet.";
      recordDayworkWriteAttempt({
        at: new Date().toISOString(),
        source: "field-daywork",
        scheduleId,
        jobId: schedule.jobId,
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
      getDayworkSheetFromStore(schedule.jobId, costCentreId) ||
      listDayworkSheetsFromStore(schedule.jobId).find((sheet) => sheet.costCentreId === costCentreId) ||
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
        source: "field-daywork",
        scheduleId,
        jobId: schedule.jobId,
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
      source: "field-daywork",
      scheduleId,
      jobId: schedule.jobId,
      costCentreId,
      ok: true,
      materialsCount,
      hasClientName,
      hasSignatures,
    });

    const requirements = dayworkRequirements(schedule.jobId, costCentreId);
    activateDayworkWorkflow(scheduleId, costCentreId, requirements);

    return NextResponse.json({
      scheduleId,
      jobId: schedule.jobId,
      costCentreId,
      checklistMode: "daywork",
      record: fieldSafeRecord(verified),
      persisted: true,
      materialsCount,
      hasClientName,
      hasSignatures,
      storeSheetCount: listDayworkSheetsFromStore().length,
      sheets: fieldSafeSheets(listDayworkSheetsForJob(schedule.jobId)),
      requirements,
    });
  }

  const requirements = dayworkRequirements(schedule.jobId, costCentreId);
  const workflow = activateDayworkWorkflow(scheduleId, costCentreId, requirements);

  return NextResponse.json({
    scheduleId,
    jobId: schedule.jobId,
    jobRef: coreJob?.ref || schedule.jobRef,
    costCentreId,
    costCentreName: DAYWORK_COST_CENTRE_NAME,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
    checklistMode: "daywork",
    record: fieldSafeRecord(resolveDayworkRecord(schedule.jobId, costCentreId)),
    sheets: fieldSafeSheets(listDayworkSheetsForJob(schedule.jobId)),
    requirements: workflow.requirements ?? requirements,
  });
}

export async function GET(request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const schedule = getEngineerScheduleItem(scheduleId);
  if (!schedule?.jobId) {
    return NextResponse.json({ error: "Schedule not found." }, { status: 404 });
  }

  const sheets = fieldSafeSheets(listDayworkSheetsForJob(schedule.jobId));
  const listOnly = new URL(request.url).searchParams.get("list") === "1";
  if (listOnly) {
    return NextResponse.json({
      scheduleId,
      jobId: schedule.jobId,
      sheets,
    });
  }

  const costCentreId = ensureDayworkVariationCostCentre(schedule.jobId);
  const requirements = dayworkRequirements(schedule.jobId, costCentreId);
  const savedSheet =
    sheets.find((sheet) => sheet.costCentreId === costCentreId) ||
    fieldSafeRecord(buildDayworkAccountRecordFromEvidence(schedule.jobId, costCentreId));

  return NextResponse.json({
    scheduleId,
    jobId: schedule.jobId,
    costCentreId,
    costCentreName: DAYWORK_COST_CENTRE_NAME,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
    record: savedSheet,
    sheets,
    requirements,
  });
}
