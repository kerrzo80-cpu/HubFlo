import { NextResponse } from "next/server";

import {
  dayworkDraftFromRecord,
  dayworkRecordFromDraft,
  parseDayworkLineItems,
  validateDayworkSheetDraft,
  type DayworkAccountRecord,
  type DayworkSheetDraft,
} from "@/lib/daywork-account-form";
import { getEngineerScheduleItem, type EngineerRequirement } from "@/lib/engineer-data";
import {
  buildDayworkAccountRecordFromEvidence,
  DAYWORK_COST_CENTRE_NAME,
  DAYWORK_COST_CENTRE_TEMPLATE,
  ensureDayworkVariationCostCentre,
  listDayworkSheetsForJob,
  requirementsFromFlowTemplate,
  saveDayworkSheetToHub,
} from "@/lib/engineer-flow";
import { activateDayworkWorkflow, clearDayworkWorkflowMode } from "@/lib/engineer-workflow-store";
import { getDayworkSheetFromStore, listDayworkSheetsFromStore } from "@/lib/daywork-sheets-store";
import { recordDayworkWriteAttempt } from "@/lib/daywork-write-log";
import { getJobs } from "@/lib/workflow-data";
import { toUkDateDisplay } from "@/lib/uk-date";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string }> };

type DayworkBody = {
  action?: string;
  createdBy?: string;
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
    });
  }

  const costCentreId = ensureDayworkVariationCostCentre(schedule.jobId);
  const coreJob = getJobs().find((job) => job.id === schedule.jobId);

  if (body.action === "save") {
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
      record: verified,
      persisted: true,
      materialsCount,
      hasClientName,
      hasSignatures,
      storeSheetCount: listDayworkSheetsFromStore().length,
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
    record: buildDayworkAccountRecordFromEvidence(schedule.jobId, costCentreId),
    requirements: workflow.requirements ?? requirements,
  });
}

export async function GET(_request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const schedule = getEngineerScheduleItem(scheduleId);
  if (!schedule?.jobId) {
    return NextResponse.json({ error: "Schedule not found." }, { status: 404 });
  }

  const costCentreId = ensureDayworkVariationCostCentre(schedule.jobId);
  const requirements = dayworkRequirements(schedule.jobId, costCentreId);
  const savedSheet =
    listDayworkSheetsForJob(schedule.jobId).find((sheet) => sheet.costCentreId === costCentreId) ||
    buildDayworkAccountRecordFromEvidence(schedule.jobId, costCentreId);

  return NextResponse.json({
    scheduleId,
    jobId: schedule.jobId,
    costCentreId,
    costCentreName: DAYWORK_COST_CENTRE_NAME,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
    record: savedSheet,
    requirements,
  });
}
