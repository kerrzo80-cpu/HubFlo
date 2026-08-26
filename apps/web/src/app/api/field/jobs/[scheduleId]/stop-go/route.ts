import { NextResponse } from "next/server";

import { parseJsonRequestBody } from "@/lib/http";
import { getEngineerScheduleItem } from "@/lib/engineer-data";
import { ensureDomesticStopGoSeed } from "@/lib/domestic-stop-go/seed";
import { findDomesticCostCentre } from "@/lib/domestic-stop-go/cost-centres";
import {
  advanceRun,
  completeRun,
  getActiveRunForCostCentre,
  getRunDto,
  launchUnsafeRun,
  saveRunAnswers,
  saveRunEvidence,
  saveSignature,
  setRunGate,
  startWorkflowRun,
} from "@/lib/domestic-stop-go/service";
import type { AnswerPatch, WorkflowSignature } from "@/lib/domestic-stop-go/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string }> };

export async function GET(_request: Request, { params }: Params) {
  ensureDomesticStopGoSeed();
  const { scheduleId } = await params;
  const job = getEngineerScheduleItem(scheduleId);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const centre = job.costCentres?.[0];
  const catalogue = findDomesticCostCentre(centre?.templateName || centre?.name || job.costCentre);
  if (!catalogue) {
    return NextResponse.json({ enabled: false });
  }
  const existing = centre?.id ? getActiveRunForCostCentre(job.jobId, centre.id) : null;
  return NextResponse.json({
    enabled: true,
    costCentre: catalogue,
    jobCostCentreId: centre?.id,
    dto: existing ? getRunDto(existing.id) : null,
  });
}

export async function POST(request: Request, { params }: Params) {
  ensureDomesticStopGoSeed();
  const { scheduleId } = await params;
  const job = getEngineerScheduleItem(scheduleId);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const centre = job.costCentres?.[0];
  const catalogue = findDomesticCostCentre(centre?.templateName || centre?.name || job.costCentre);
  if (!catalogue || !centre?.id) {
    return NextResponse.json({ error: "This job is not a domestic stop/go cost centre." }, { status: 400 });
  }
  const body = (await parseJsonRequestBody<{
    action?: string;
    answers?: AnswerPatch[];
    fieldKey?: string;
    photoName?: string;
    photoContentBase64?: string;
    photoMimeType?: string;
    caption?: string;
    syncId?: string;
    gateKey?: string;
    signature?: Partial<WorkflowSignature>;
  }>(request)) || {};
  const actorId = job.engineerId || "eng-chris";
  try {
    let dto = centre.id
      ? (() => {
          const existing = getActiveRunForCostCentre(job.jobId, centre.id);
          return existing
            ? getRunDto(existing.id)
            : startWorkflowRun({
                jobId: job.jobId,
                jobCostCentreId: centre.id,
                costCentreCodeOrName: catalogue.stableCode,
                actorId,
                actorName: job.engineerName,
                scheduleId,
              });
        })()
      : null;
    if (!dto) throw new Error("Could not start workflow.");
    const runId = dto.run.id;
    const action = body.action || "start";
    if (action === "answers" && body.answers) dto = saveRunAnswers(runId, body.answers, actorId);
    if (action === "evidence" && body.fieldKey) {
      dto = saveRunEvidence(runId, {
        fieldKey: body.fieldKey,
        actorId,
        photoName: body.photoName,
        photoContentBase64: body.photoContentBase64,
        photoMimeType: body.photoMimeType,
        caption: body.caption,
        syncId: body.syncId,
      });
    }
    if (action === "advance") dto = advanceRun(runId, actorId);
    if (action === "open-gate" && body.gateKey) dto = setRunGate(runId, body.gateKey, actorId);
    if (action === "launch-unsafe") dto = launchUnsafeRun(runId, actorId).origin;
    if (action === "complete") dto = await completeRun(runId, actorId);
    if (action === "signature" && body.signature?.role && body.signature.status && body.signature.signerName) {
      dto = saveSignature(runId, {
        role: body.signature.role,
        signerName: body.signature.signerName,
        signerCapacity: body.signature.signerCapacity || "",
        signatureDataUrl: body.signature.signatureDataUrl,
        status: body.signature.status,
        refusalReason: body.signature.refusalReason,
        actorId,
      });
    }
    return NextResponse.json(dto);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Stop/go failed." }, { status: 400 });
  }
}
