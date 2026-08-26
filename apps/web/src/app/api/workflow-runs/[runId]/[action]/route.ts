import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { actorFromHeaders } from "@/lib/domestic-stop-go/http";
import {
  advanceRun,
  closeUnsafeFollowUp,
  completeRun,
  createRevision,
  getRunDto,
  launchUnsafeRun,
  saveRunAnswers,
  saveRunEvidence,
  saveSignature,
  setNotificationStatus,
  setRunGate,
  validateRunGate,
} from "@/lib/domestic-stop-go/service";
import { createDomesticWorkRecordPdf } from "@/lib/domestic-stop-go/pdf";
import type { AnswerPatch, WorkflowSignature } from "@/lib/domestic-stop-go/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ runId: string; action: string }> };

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs) return forbidden();
  const { runId, action } = await params;
  if (action !== "record-preview") {
    return NextResponse.json({ error: "Unknown action." }, { status: 404 });
  }
  try {
    const dto = getRunDto(runId);
    const template = dto.template;
    if (!template) return NextResponse.json({ error: "Template missing." }, { status: 404 });
    const snapshotRecord = dto.record || {
      id: "preview",
      runId,
      tenantId: dto.run.tenantId,
      jobId: dto.run.jobId,
      recordType: template.recordTitle,
      recordNumber: "DRAFT",
      dataSnapshot: {
        answers: Object.fromEntries(dto.answers.map((item) => [item.fieldKey, item])),
        signatures: dto.signatures,
      },
      schemaVersion: template.version,
      generatedAt: new Date().toISOString(),
      lockedAt: "",
      verificationCode: "DRAFT",
    };
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "pdf") {
      const bytes = await createDomesticWorkRecordPdf({
        record: snapshotRecord,
        template,
        jobRef: dto.run.jobId,
        customer: "",
        site: "",
        sample: dto.run.status !== "complete",
      });
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "inline; filename=\"nexa-work-record-preview.pdf\"",
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({
      draft: dto.run.status !== "complete",
      record: snapshotRecord,
      templateId: template.id,
      answers: dto.answers,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Preview failed." }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.canEditJobs) return forbidden();
  const { runId, action } = await params;
  const actor = actorFromHeaders(request.headers);
  try {
    if (action === "answers") {
      const body = (await parseJsonRequestBody<{ answers?: AnswerPatch[]; patches?: AnswerPatch[] }>(request)) || {};
      return NextResponse.json(saveRunAnswers(runId, body.answers || body.patches || [], actor.actorId));
    }
    if (action === "notification-status") {
      if (!access.canCustomize && actor.role !== "Office" && actor.role !== "Owner/Admin" && actor.role !== "Manager") {
        return forbidden();
      }
      const body = (await parseJsonRequestBody<{ status?: string }>(request)) || {};
      return NextResponse.json(setNotificationStatus(runId, String(body.status || ""), actor.actorId));
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed." }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.canEditJobs) return forbidden();
  const { runId, action } = await params;
  const actor = actorFromHeaders(request.headers);
  try {
    if (action === "evidence") {
      const body = (await parseJsonRequestBody<{
        fieldKey?: string;
        caption?: string;
        photoName?: string;
        photoContentBase64?: string;
        photoMimeType?: string;
        syncId?: string;
        deviceTimestamp?: string;
      }>(request)) || {};
      if (!body.fieldKey) return NextResponse.json({ error: "fieldKey is required." }, { status: 400 });
      return NextResponse.json(saveRunEvidence(runId, { ...body, fieldKey: body.fieldKey, actorId: actor.actorId }));
    }
    if (action === "validate-gate") {
      const body = (await parseJsonRequestBody<{ gateKey?: string }>(request)) || {};
      return NextResponse.json(validateRunGate(runId, body.gateKey));
    }
    if (action === "advance") {
      return NextResponse.json(advanceRun(runId, actor.actorId));
    }
    if (action === "open-gate") {
      const body = (await parseJsonRequestBody<{ gateKey?: string }>(request)) || {};
      return NextResponse.json(setRunGate(runId, String(body.gateKey || ""), actor.actorId));
    }
    if (action === "signatures") {
      const body = (await parseJsonRequestBody<Partial<WorkflowSignature> & { actorId?: string }>(request)) || {};
      if (!body.role || !body.status || !body.signerName) {
        return NextResponse.json({ error: "role, signerName and status are required." }, { status: 400 });
      }
      return NextResponse.json(saveSignature(runId, {
        role: body.role,
        signerName: body.signerName,
        signerCapacity: body.signerCapacity || "",
        signatureFileId: body.signatureFileId,
        signatureDataUrl: body.signatureDataUrl,
        status: body.status,
        refusalReason: body.refusalReason,
        signedByUserId: actor.actorId,
        actorId: actor.actorId,
      }));
    }
    if (action === "launch-unsafe") {
      return NextResponse.json(launchUnsafeRun(runId, actor.actorId));
    }
    if (action === "complete") {
      return NextResponse.json(await completeRun(runId, actor.actorId));
    }
    if (action === "create-revision") {
      return NextResponse.json(createRevision(runId, actor.actorId));
    }
    if (action === "close-follow-up") {
      if (!access.canCustomize) return forbidden();
      const body = (await parseJsonRequestBody<{ reason?: string }>(request)) || {};
      return NextResponse.json(closeUnsafeFollowUp(runId, actor.actorId, String(body.reason || "")));
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 400 });
  }
}
