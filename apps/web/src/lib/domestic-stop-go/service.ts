import { createHash } from "node:crypto";

import { appendAuditEvent } from "@/lib/people-data";
import { saveUploadedRecordDocument } from "@/lib/record-documents";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { getJobs } from "@/lib/workflow-data";
import { getEngineerScheduleItem } from "@/lib/engineer-data";
import { findDomesticCostCentre } from "@/lib/domestic-stop-go/cost-centres";
import { getPublishedTemplate, getPublishedTemplateById } from "@/lib/domestic-stop-go/templates";
import { evaluateRules } from "@/lib/domestic-stop-go/rules-engine";
import { createDomesticWorkRecordPdf } from "@/lib/domestic-stop-go/pdf";
import { annotateAttendanceHelp, buildAttendancePrefill, scheduledSlotLabel } from "@/lib/domestic-stop-go/prefill";
import {
  assertTenant,
  getDomesticStopGoStore,
  newId,
  saveDomesticStopGoStore,
  seedDomesticCostCentresIdempotent,
} from "@/lib/domestic-stop-go/store";
import type {
  AnswerPatch,
  EmployeeCompetency,
  FieldAnswerStatus,
  GeneratedRecord,
  RuleError,
  WorkflowAnswer,
  WorkflowAuditEvent,
  WorkflowEvidence,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSignature,
  WorkflowTemplate,
} from "@/lib/domestic-stop-go/types";
import { DOMESTIC_TENANT_ID } from "@/lib/domestic-stop-go/types";

const FINAL_STATUSES: WorkflowRunStatus[] = ["complete", "superseded", "cancelled"];

function nowIso() {
  return new Date().toISOString();
}

function audit(runId: string, actorId: string, eventType: string, extra: Partial<WorkflowAuditEvent> = {}) {
  const store = getDomesticStopGoStore();
  const event: WorkflowAuditEvent = {
    id: newId("audit"),
    runId,
    actorId,
    eventType,
    occurredAt: nowIso(),
    ...extra,
  };
  store.audit.unshift(event);
  try {
    appendAuditEvent({
      actor: actorId,
      action: eventType,
      recordType: "workflow_run",
      recordId: runId,
      summary: extra.fieldKey ? `${eventType} · ${extra.fieldKey}` : eventType,
      source: "domestic-stop-go",
      importance: eventType.includes("unsafe") || eventType.includes("complete") ? "high" : "normal",
    });
  } catch {
    // People audit is best-effort.
  }
  return event;
}

function appendTimeline(jobId: string, jobRef: string, summary: string, actor: string, extra: Record<string, unknown> = {}) {
  const hub = getHubDetailState();
  const events = Array.isArray(hub.jobDeliveryEvents) ? hub.jobDeliveryEvents : [];
  saveHubDetailState({
    ...hub,
    jobDeliveryEvents: [
      {
        id: newId("delivery"),
        createdAt: nowIso(),
        source: "Engineer app",
        jobId,
        jobRef,
        kind: extra.kind || "compliance",
        actor,
        summary,
        status: extra.status || "Recorded",
        ...extra,
      },
      ...events,
    ],
  });
}

export function competencyIsCurrent(item: EmployeeCompetency, at = new Date()) {
  if (!item.active) return false;
  const from = Date.parse(item.validFrom);
  const expires = Date.parse(item.expiresAt);
  const t = at.getTime();
  if (Number.isFinite(from) && t < from) return false;
  if (Number.isFinite(expires) && t > expires) return false;
  return true;
}

export function engineerHasCompetency(employeeId: string, scheme: EmployeeCompetency["scheme"]) {
  const store = getDomesticStopGoStore();
  return store.competencies.some((item) => item.employeeId === employeeId && item.scheme === scheme && competencyIsCurrent(item));
}

export function competencyExpiryBoard() {
  const store = getDomesticStopGoStore();
  const soon = Date.now() + 60 * 24 * 60 * 60 * 1000;
  return store.competencies
    .filter((item) => item.active)
    .map((item) => ({
      ...item,
      expired: !competencyIsCurrent(item),
      expiring: competencyIsCurrent(item) && Date.parse(item.expiresAt) <= soon,
    }))
    .filter((item) => item.expired || item.expiring);
}

function runOrThrow(runId: string, tenantId?: string) {
  const store = getDomesticStopGoStore();
  assertTenant(tenantId);
  const run = store.runs.find((item) => item.id === runId && item.tenantId === store.tenantId);
  if (!run) throw new Error("Workflow run not found.");
  return run;
}

export function getTemplateForRun(run: WorkflowRun) {
  return getPublishedTemplateById(run.templateId) || getPublishedTemplate(run.costCentreCode, run.templateVersion);
}

function answersForRun(runId: string) {
  return getDomesticStopGoStore().answers.filter((item) => item.runId === runId);
}

function evidenceForRun(runId: string) {
  return getDomesticStopGoStore().evidence.filter((item) => item.runId === runId);
}

function signaturesForRun(runId: string) {
  return getDomesticStopGoStore().signatures.filter((item) => item.runId === runId);
}

function linkedUnsafeComplete(run: WorkflowRun) {
  if (!run.linkedUnsafeRunId) return false;
  const linked = getDomesticStopGoStore().runs.find((item) => item.id === run.linkedUnsafeRunId);
  return linked?.status === "complete";
}

function deriveStatus(run: WorkflowRun, template: WorkflowTemplate, gateErrors: RuleError[], completionErrors: RuleError[]): WorkflowRunStatus {
  if (FINAL_STATUSES.includes(run.status) && run.status !== "complete") return run.status;
  const launch = [...gateErrors, ...completionErrors].find((item) => item.code === "LAUNCH_LINKED_WORKFLOW");
  if (launch && !linkedUnsafeComplete(run)) return "blocked_unsafe";
  const blocking = gateErrors.filter((item) => item.severity === "blocking");
  const engineerSig = signaturesForRun(run.id).find((item) => item.role === "engineer" && item.status === "signed");
  const customerAck = answersForRun(run.id).find((item) => item.fieldKey === "review.customer_sign_status");
  if (run.status === "complete") return "complete";
  if (!completionErrors.length && engineerSig && customerAck?.value) return "awaiting_customer_acknowledgement";
  if (!gateErrors.filter((e) => e.gateKey === template.gates.at(-1)?.key).length && !engineerSig) {
    const lastGate = template.gates.at(-1)?.key;
    if (run.currentGateKey === lastGate) return "awaiting_engineer_signature";
  }
  if (blocking.length) return "blocked_missing_required";
  return "in_progress";
}

function isBlankAnswer(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function writeAnswers(
  run: WorkflowRun,
  patches: AnswerPatch[],
  actor: string,
  source: WorkflowAnswer["source"] = "engineer",
  options?: { fillEmptyOnly?: boolean },
) {
  const store = getDomesticStopGoStore();
  const template = getTemplateForRun(run);
  if (!template) throw new Error("Published workflow template not found.");
  if (run.status === "complete") throw new Error("Completed records cannot be silently edited. Create a revision.");
  const existing = answersForRun(run.id);
  let wrote = false;
  for (const patch of patches) {
    const repeatGroupId = patch.repeatGroupId ?? null;
    const field = template.fields.find((item) => item.fieldKey === patch.fieldKey);
    if (!field) continue;
    if (patch.syncId && existing.some((item) => item.syncId === patch.syncId)) continue;
    const current = existing.find((item) => item.fieldKey === patch.fieldKey && (item.repeatGroupId || null) === repeatGroupId);
    if (options?.fillEmptyOnly && !isBlankAnswer(current?.value)) continue;
    if (options?.fillEmptyOnly && isBlankAnswer(patch.value)) continue;
    const nextStatus: FieldAnswerStatus = patch.answerStatus || current?.answerStatus || "answered";
    const next: WorkflowAnswer = {
      id: current?.id || newId("ans"),
      runId: run.id,
      fieldKey: patch.fieldKey,
      repeatGroupId,
      value: patch.value !== undefined ? patch.value : current?.value,
      answerStatus: nextStatus,
      reason: patch.reason ?? current?.reason,
      answeredBy: actor,
      answeredAt: nowIso(),
      source,
      revision: (current?.revision || 0) + 1,
      clientRevision: patch.clientRevision,
      syncId: patch.syncId,
      deviceTimestamp: patch.deviceTimestamp,
    };
    if (current && field.invalidatesDownstream && JSON.stringify(current.value) !== JSON.stringify(next.value)) {
      run.invalidatedFromGateKey = template.gates.find((gate) => gate.fieldKeys.includes(field.fieldKey))?.key;
      store.signatures = store.signatures.filter((item) => item.runId !== run.id);
      audit(run.id, actor, "invalidated_downstream", { fieldKey: field.fieldKey, beforeJson: current.value, afterJson: next.value });
    }
    store.answers = [next, ...store.answers.filter((item) => item.id !== next.id)];
    wrote = true;
    audit(run.id, actor, "answer_saved", {
      fieldKey: patch.fieldKey,
      beforeJson: current?.value,
      afterJson: next.value,
      syncId: patch.syncId,
    });
  }
  if (wrote) saveDomesticStopGoStore();
}

export function startWorkflowRun(input: {
  jobId: string;
  jobCostCentreId: string;
  costCentreCodeOrName: string;
  actorId: string;
  actorName?: string;
  scheduleId?: string;
  tenantId?: string;
  originatingRunId?: string;
  prefillFromRunId?: string;
}) {
  seedDomesticCostCentresIdempotent();
  const tenantId = assertTenant(input.tenantId);
  const catalogue = findDomesticCostCentre(input.costCentreCodeOrName);
  if (!catalogue || !catalogue.active) throw new Error("Unknown or inactive domestic stop/go cost centre.");
  const template = getPublishedTemplate(catalogue.stableCode);
  if (!template) throw new Error("No published workflow template for this cost centre.");
  const store = getDomesticStopGoStore();
  const existing = store.runs.find(
    (item) =>
      item.tenantId === tenantId
      && item.jobId === input.jobId
      && item.jobCostCentreId === input.jobCostCentreId
      && item.costCentreCode === catalogue.stableCode
      && !FINAL_STATUSES.includes(item.status),
  );
  if (existing) return serializeRun(existing);

  if (!engineerHasCompetency(input.actorId, template.competencyScheme) && input.actorId !== "office-admin") {
    // Field engineers use their schedule engineer id (eng-chris). Office/admin can still open.
    if (!input.actorId.startsWith("eng-") || !engineerHasCompetency(input.actorId, template.competencyScheme)) {
      const stillMissing = !engineerHasCompetency(input.actorId, template.competencyScheme);
      if (stillMissing) {
        throw new Error(
          `Engineer competency is not valid for ${template.competencyScheme} work. Office has been notified.`,
        );
      }
    }
  }

  const job = getJobs().find((item) => item.id === input.jobId);
  const run: WorkflowRun = {
    id: newId("run"),
    tenantId,
    jobId: input.jobId,
    jobCostCentreId: input.jobCostCentreId,
    scheduleId: input.scheduleId,
    templateId: template.id,
    templateVersion: template.version,
    costCentreCode: catalogue.stableCode,
    status: "in_progress",
    currentGateKey: template.gates[0]?.key || "attendance",
    startedBy: input.actorId,
    startedAt: nowIso(),
    originatingRunId: input.originatingRunId,
    revision: 1,
  };
  store.runs.unshift(run);
  writeAnswers(
    run,
    buildAttendancePrefill({
      run,
      actorId: input.actorId,
      actorName: input.actorName,
      job,
      scheduleId: input.scheduleId,
      costCentreName: catalogue.displayName,
    }),
    input.actorId,
    "system",
  );
  writeAnswers(
    run,
    [
      {
        fieldKey: "attendance.competency_confirmed",
        value: engineerHasCompetency(input.actorId, template.competencyScheme) ? "yes" : "no",
      },
    ],
    input.actorId,
    "system",
  );
  if (input.prefillFromRunId) {
    const source = answersForRun(input.prefillFromRunId).filter((item) =>
      ["attendance.", "safe_start.", "service.", "repair.", "new."].some((prefix) => item.fieldKey.startsWith(prefix)),
    );
    writeAnswers(
      run,
      source.map((item) => ({ fieldKey: item.fieldKey, value: item.value, answerStatus: item.answerStatus, reason: item.reason })),
      input.actorId,
      "system",
    );
  }
  audit(run.id, input.actorId, "run_started");
  if (job) appendTimeline(job.id, job.ref, `${catalogue.displayName} workflow started.`, input.actorName || input.actorId, { kind: "compliance" });
  saveDomesticStopGoStore();
  return serializeRun(run);
}

export function saveRunAnswers(runId: string, patches: AnswerPatch[], actorId: string, tenantId?: string) {
  const run = runOrThrow(runId, tenantId);
  writeAnswers(run, patches, actorId);
  refreshRunStatus(run, actorId);
  return serializeRun(run);
}

export function saveRunEvidence(runId: string, input: {
  fieldKey: string;
  actorId: string;
  caption?: string;
  photoName?: string;
  photoContentBase64?: string;
  photoMimeType?: string;
  syncId?: string;
  deviceTimestamp?: string;
  tenantId?: string;
}) {
  const run = runOrThrow(runId, input.tenantId);
  const store = getDomesticStopGoStore();
  if (input.syncId && store.evidence.some((item) => item.id === input.syncId || item.sha256 === input.syncId)) {
    return serializeRun(run);
  }
  const bytes = input.photoContentBase64 ? Buffer.from(input.photoContentBase64, "base64") : Buffer.from("");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (store.evidence.some((item) => item.runId === runId && item.sha256 === sha256 && item.fieldKey === input.fieldKey)) {
    return serializeRun(run);
  }
  const evidence: WorkflowEvidence = {
    id: input.syncId || newId("evd"),
    runId,
    fieldKey: input.fieldKey,
    fileId: newId("file"),
    caption: input.caption || "",
    capturedBy: input.actorId,
    capturedAt: nowIso(),
    deviceTimestamp: input.deviceTimestamp || nowIso(),
    serverTimestamp: nowIso(),
    sha256,
    photoName: input.photoName,
  };
  store.evidence.unshift(evidence);
  writeAnswers(run, [{ fieldKey: input.fieldKey, value: input.photoName || evidence.id, answerStatus: "answered" }], input.actorId);
  audit(run.id, input.actorId, "evidence_saved", { fieldKey: input.fieldKey, syncId: input.syncId });
  refreshRunStatus(run, input.actorId);
  return serializeRun(run);
}

export function validateRunGate(runId: string, gateKey: string | undefined, tenantId?: string) {
  const run = runOrThrow(runId, tenantId);
  const template = getTemplateForRun(run);
  if (!template) throw new Error("Template missing.");
  const key = gateKey || run.currentGateKey;
  const errors = evaluateRules({
    template,
    answers: answersForRun(run.id),
    evidence: evidenceForRun(run.id),
    signatures: signaturesForRun(run.id),
    gateKey: key,
    mode: "gate",
  });
  return { runId: run.id, gateKey: key, ok: errors.length === 0, errors };
}

export function advanceRun(runId: string, actorId: string, tenantId?: string) {
  const run = runOrThrow(runId, tenantId);
  const template = getTemplateForRun(run);
  if (!template) throw new Error("Template missing.");
  const currentIndex = template.gates.findIndex((item) => item.key === run.currentGateKey);
  const gate = template.gates[currentIndex];
  const errors = evaluateRules({
    template,
    answers: answersForRun(run.id),
    evidence: evidenceForRun(run.id),
    signatures: signaturesForRun(run.id),
    gateKey: gate?.key,
    mode: "gate",
  });
  const launch = errors.find((item) => item.code === "LAUNCH_LINKED_WORKFLOW");
  if (launch) {
    run.status = "blocked_unsafe";
    saveDomesticStopGoStore();
    throw new Error(launch.message);
  }
  if (errors.length) {
    run.status = "blocked_missing_required";
    saveDomesticStopGoStore();
    throw new Error(errors[0]?.message || "Finish required fields before continuing.");
  }
  const next = template.gates[currentIndex + 1];
  if (next) run.currentGateKey = next.key;
  run.status = "in_progress";
  audit(run.id, actorId, "gate_completed", { fieldKey: gate?.key });
  const job = getJobs().find((item) => item.id === run.jobId);
  if (job) appendTimeline(job.id, job.ref, `${gate?.label || "Gate"} completed.`, actorId);
  saveDomesticStopGoStore();
  return serializeRun(run);
}

export function setRunGate(runId: string, gateKey: string, actorId: string, tenantId?: string) {
  const run = runOrThrow(runId, tenantId);
  const template = getTemplateForRun(run);
  if (!template?.gates.some((item) => item.key === gateKey)) throw new Error("Unknown gate.");
  run.currentGateKey = gateKey;
  audit(run.id, actorId, "gate_opened", { fieldKey: gateKey });
  saveDomesticStopGoStore();
  return serializeRun(run);
}

export function saveSignature(runId: string, input: Omit<WorkflowSignature, "id" | "runId" | "signedAt"> & { tenantId?: string; actorId: string }) {
  const run = runOrThrow(runId, input.tenantId);
  if (run.status === "complete") throw new Error("Completed records cannot be silently edited.");
  const store = getDomesticStopGoStore();
  const signature: WorkflowSignature = {
    id: newId("sig"),
    runId,
    role: input.role,
    signerName: input.signerName,
    signerCapacity: input.signerCapacity,
    signatureFileId: input.signatureFileId,
    signatureDataUrl: input.signatureDataUrl,
    status: input.status,
    refusalReason: input.refusalReason,
    signedAt: nowIso(),
    signedByUserId: input.signedByUserId || input.actorId,
  };
  if (signature.status !== "signed" && !String(signature.refusalReason || "").trim()) {
    throw new Error("Record refusal or not-present reason — do not silently skip the acknowledgement.");
  }
  store.signatures = [signature, ...store.signatures.filter((item) => !(item.runId === runId && item.role === input.role))];
  writeAnswers(
    run,
    input.role === "engineer"
      ? [{ fieldKey: "review.engineer_signature", value: signature.signerName, answerStatus: "answered" }]
      : [
          { fieldKey: "review.customer_signature", value: signature.status === "signed" ? signature.signerName : signature.status, answerStatus: "answered" },
          { fieldKey: "review.customer_sign_status", value: signature.status },
          { fieldKey: "review.customer_sign_reason", value: signature.refusalReason || "" },
        ],
    input.actorId,
  );
  audit(run.id, input.actorId, "signature_saved", { fieldKey: input.role });
  const job = getJobs().find((item) => item.id === run.jobId);
  if (job) appendTimeline(job.id, job.ref, `${input.role} acknowledgement recorded (${signature.status}).`, input.actorId);
  refreshRunStatus(run, input.actorId);
  return serializeRun(run);
}

export function launchUnsafeRun(runId: string, actorId: string, tenantId?: string) {
  const run = runOrThrow(runId, tenantId);
  const template = getTemplateForRun(run);
  const code = template?.linkedUnsafeCode || (template?.fuel === "oil" ? "DOM_OIL_SERVICE_TANK" : "DOM_GAS_UNSAFE");
  const unsafe = startWorkflowRun({
    jobId: run.jobId,
    jobCostCentreId: `${run.jobCostCentreId}-unsafe`,
    costCentreCodeOrName: code,
    actorId,
    scheduleId: run.scheduleId,
    originatingRunId: run.id,
    prefillFromRunId: run.id,
  });
  run.linkedUnsafeRunId = unsafe.run.id;
  run.status = "blocked_unsafe";
  run.highPriorityFollowUp = { open: true, createdAt: nowIso() };
  audit(run.id, actorId, "unsafe_launched", { afterJson: { linkedUnsafeRunId: unsafe.run.id } });
  const job = getJobs().find((item) => item.id === run.jobId);
  if (job) {
    appendTimeline(job.id, job.ref, "High-priority unsafe / make-safe follow-up opened.", actorId, {
      kind: "safety",
      status: "High priority",
    });
  }
  saveDomesticStopGoStore();
  return { origin: serializeRun(run), unsafe };
}

export async function completeRun(runId: string, actorId: string, tenantId?: string) {
  const run = runOrThrow(runId, tenantId);
  const template = getTemplateForRun(run);
  if (!template) throw new Error("Template missing.");
  if (run.status === "complete") return serializeRun(run);
  const errors = evaluateRules({
    template,
    answers: answersForRun(run.id),
    evidence: evidenceForRun(run.id),
    signatures: signaturesForRun(run.id),
    mode: "completion",
  });
  const launch = errors.find((item) => item.code === "LAUNCH_LINKED_WORKFLOW");
  if (launch && !linkedUnsafeComplete(run)) {
    run.status = "blocked_unsafe";
    saveDomesticStopGoStore();
    throw new Error(launch.message);
  }
  const remaining = errors.filter((item) => item.code !== "LAUNCH_LINKED_WORKFLOW" || !linkedUnsafeComplete(run));
  if (remaining.length) {
    run.status = "blocked_missing_required";
    saveDomesticStopGoStore();
    throw new Error(remaining[0]?.message || "Record is not complete.");
  }
  const engineerSig = signaturesForRun(run.id).find((item) => item.role === "engineer");
  if (!engineerSig) throw new Error("Engineer signature is required to complete.");
  const job = getJobs().find((item) => item.id === run.jobId);
  writeAnswers(
    run,
    [{ fieldKey: "review.completion_timestamp", value: nowIso() }],
    actorId,
    "system",
  );
  const store = getDomesticStopGoStore();
  const settings = store.settings;
  const recordNumber = `${settings.recordPrefix}-${String(settings.nextRecordNumber).padStart(4, "0")}`;
  settings.nextRecordNumber += 1;
  const snapshot = buildSnapshot(run, template);
  const verificationCode = createHash("sha256").update(`${run.id}:${recordNumber}:${nowIso()}`).digest("hex").slice(0, 12).toUpperCase();
  const generated: GeneratedRecord = {
    id: newId("rec"),
    runId: run.id,
    tenantId: run.tenantId,
    jobId: run.jobId,
    recordType: template.recordTitle,
    recordNumber,
    dataSnapshot: snapshot,
    schemaVersion: template.version,
    generatedAt: nowIso(),
    lockedAt: nowIso(),
    verificationCode,
  };
  const pdfBytes = await createDomesticWorkRecordPdf({
    record: generated,
    template,
    jobRef: job?.ref || run.jobId,
    customer: job?.customer || "",
    site: job?.site || "",
  });
  const savedDoc = saveUploadedRecordDocument({
    scope: "job",
    recordRef: job?.ref || run.jobId,
    folderId: "forms-certificates",
    visibility: settings.customerPdfVisible ? "Client" : "Engineer",
    fileName: `${recordNumber.replace(/\s+/g, "_")}.pdf`,
    mimeType: "application/pdf",
    bytes: pdfBytes,
    linkedTo: run.jobCostCentreId,
  });
  generated.pdfDocumentId = savedDoc.id;
  generated.pdfFileId = savedDoc.id;
  store.records.unshift(generated);
  run.status = "complete";
  run.completedAt = nowIso();
  audit(run.id, actorId, "record_completed", { afterJson: { recordNumber } });
  if (job) {
    appendTimeline(job.id, job.ref, "Compliance record completed", actorId, {
      kind: "compliance",
      status: recordNumber,
    });
  }
  saveDomesticStopGoStore();
  return serializeRun(run);
}

export function createRevision(runId: string, actorId: string, tenantId?: string) {
  const previous = runOrThrow(runId, tenantId);
  if (previous.status !== "complete") throw new Error("Only completed records can be revised.");
  previous.status = "superseded";
  const next = startWorkflowRun({
    jobId: previous.jobId,
    jobCostCentreId: previous.jobCostCentreId,
    costCentreCodeOrName: previous.costCentreCode,
    actorId,
    scheduleId: previous.scheduleId,
    prefillFromRunId: previous.id,
  });
  const store = getDomesticStopGoStore();
  const fresh = store.runs.find((item) => item.id === next.run.id);
  if (fresh) fresh.revision = previous.revision + 1;
  audit(next.run.id, actorId, "revision_created", { beforeJson: { supersedes: previous.id } });
  saveDomesticStopGoStore();
  return serializeRun(runOrThrow(next.run.id, tenantId));
}

export function setNotificationStatus(runId: string, status: string, actorId: string, tenantId?: string) {
  const run = runOrThrow(runId, tenantId);
  writeAnswers(run, [{ fieldKey: "hand.notification_status", value: status }, { fieldKey: "oilhand.notification_status", value: status }], actorId, "office");
  audit(run.id, actorId, "notification_status", { afterJson: { status } });
  const job = getJobs().find((item) => item.id === run.jobId);
  if (job) appendTimeline(job.id, job.ref, `External notification status: ${status}.`, actorId);
  saveDomesticStopGoStore();
  return serializeRun(run);
}

export function closeUnsafeFollowUp(runId: string, actorId: string, reason: string, tenantId?: string) {
  const run = runOrThrow(runId, tenantId);
  if (!String(reason || "").trim()) throw new Error("A close reason is required.");
  run.highPriorityFollowUp = {
    ...(run.highPriorityFollowUp || { open: true, createdAt: nowIso() }),
    open: false,
    closedAt: nowIso(),
    closedBy: actorId,
    closeReason: reason,
  };
  audit(run.id, actorId, "follow_up_closed", { afterJson: { reason } });
  saveDomesticStopGoStore();
  return serializeRun(run);
}

function refreshRunStatus(run: WorkflowRun, _actorId: string) {
  const template = getTemplateForRun(run);
  if (!template) return;
  const gateErrors = evaluateRules({
    template,
    answers: answersForRun(run.id),
    evidence: evidenceForRun(run.id),
    signatures: signaturesForRun(run.id),
    gateKey: run.currentGateKey,
    mode: "gate",
  });
  const launch = gateErrors.find((item) => item.code === "LAUNCH_LINKED_WORKFLOW");
  if (launch && !linkedUnsafeComplete(run)) run.status = "blocked_unsafe";
  else if (run.status !== "complete") {
    run.status = deriveStatus(run, template, gateErrors, []);
  }
  saveDomesticStopGoStore();
}

function buildSnapshot(run: WorkflowRun, template: WorkflowTemplate) {
  const map: Record<string, unknown> = {};
  for (const answer of answersForRun(run.id)) {
    map[answer.repeatGroupId ? `${answer.fieldKey}::${answer.repeatGroupId}` : answer.fieldKey] = {
      value: answer.value,
      answerStatus: answer.answerStatus,
      reason: answer.reason,
      answeredAt: answer.answeredAt,
      answeredBy: answer.answeredBy,
    };
  }
  return {
    recordTitle: template.recordTitle,
    costCentreCode: run.costCentreCode,
    templateId: template.id,
    templateVersion: template.version,
    answers: map,
    signatures: signaturesForRun(run.id).map((item) => ({
      role: item.role,
      signerName: item.signerName,
      status: item.status,
      refusalReason: item.refusalReason,
      signedAt: item.signedAt,
    })),
    evidence: evidenceForRun(run.id).map((item) => ({
      fieldKey: item.fieldKey,
      caption: item.caption,
      photoName: item.photoName,
      sha256: item.sha256,
    })),
  };
}

function hydrateAttendancePrefill(run: WorkflowRun) {
  if (FINAL_STATUSES.includes(run.status)) return;
  const job = getJobs().find((item) => item.id === run.jobId);
  const schedule = run.scheduleId ? getEngineerScheduleItem(run.scheduleId) : null;
  writeAnswers(
    run,
    buildAttendancePrefill({
      run,
      actorId: run.startedBy,
      actorName: schedule?.engineerName,
      job,
      scheduleId: run.scheduleId,
    }),
    run.startedBy,
    "system",
    { fillEmptyOnly: true },
  );
}

export function serializeRun(run: WorkflowRun) {
  hydrateAttendancePrefill(run);
  const template = getTemplateForRun(run);
  const answers = answersForRun(run.id);
  const evidence = evidenceForRun(run.id);
  const signatures = signaturesForRun(run.id);
  const record = getDomesticStopGoStore().records.find((item) => item.runId === run.id && !item.supersedesId);
  const schedule = run.scheduleId ? getEngineerScheduleItem(run.scheduleId) : null;
  const job = getJobs().find((item) => item.id === run.jobId);
  const displayTemplate = template
    ? annotateAttendanceHelp(template, scheduledSlotLabel(schedule, job))
    : template;
  const gateErrors = template
    ? evaluateRules({ template, answers, evidence, signatures, gateKey: run.currentGateKey, mode: "gate" })
    : [];
  const completionErrors = template
    ? evaluateRules({ template, answers, evidence, signatures, mode: "completion" })
    : [];
  const currentGate = template?.gates.find((item) => item.key === run.currentGateKey) || null;
  const currentIndex = template ? Math.max(0, template.gates.findIndex((item) => item.key === run.currentGateKey)) : 0;
  return {
    run: { ...run },
    template: displayTemplate,
    currentGate,
    progress: {
      index: currentIndex,
      total: template?.gates.length || 0,
      label: currentGate?.label || "",
    },
    answers,
    evidence,
    signatures,
    record,
    gateErrors,
    completionErrors,
    canAdvance: gateErrors.length === 0,
    canComplete: completionErrors.filter((item) => item.code !== "LAUNCH_LINKED_WORKFLOW" || !linkedUnsafeComplete(run)).length === 0
      && signatures.some((item) => item.role === "engineer"),
  };
}

export function getRunDto(runId: string, tenantId?: string) {
  return serializeRun(runOrThrow(runId, tenantId));
}

export function listRunsForJob(jobId: string, tenantId?: string) {
  assertTenant(tenantId);
  return getDomesticStopGoStore()
    .runs.filter((item) => item.jobId === jobId && item.tenantId === DOMESTIC_TENANT_ID)
    .map((item) => serializeRun(item));
}

export function getActiveRunForCostCentre(jobId: string, jobCostCentreId: string) {
  return getDomesticStopGoStore().runs.find(
    (item) => item.jobId === jobId && item.jobCostCentreId === jobCostCentreId && !FINAL_STATUSES.includes(item.status),
  ) ?? getDomesticStopGoStore().runs.find((item) => item.jobId === jobId && item.jobCostCentreId === jobCostCentreId);
}

export function officeBoard() {
  seedDomesticCostCentresIdempotent();
  const store = getDomesticStopGoStore();
  const buckets = {
    not_started: [] as WorkflowRun[],
    in_progress: [] as WorkflowRun[],
    ready_to_complete_when_connected: [] as WorkflowRun[],
    blocked_missing_required: [] as WorkflowRun[],
    blocked_unsafe: [] as WorkflowRun[],
    awaiting_engineer_signature: [] as WorkflowRun[],
    awaiting_customer_acknowledgement: [] as WorkflowRun[],
    complete: [] as WorkflowRun[],
    notification_pending: [] as WorkflowRun[],
    competency: [] as WorkflowRun[],
  };
  for (const run of store.runs) {
    if (run.readyToCompleteWhenConnected) buckets.ready_to_complete_when_connected.push(run);
    if (run.status === "not_started") buckets.not_started.push(run);
    else if (run.status === "in_progress") buckets.in_progress.push(run);
    else if (run.status === "blocked_missing_required") buckets.blocked_missing_required.push(run);
    else if (run.status === "blocked_unsafe") buckets.blocked_unsafe.push(run);
    else if (run.status === "awaiting_engineer_signature") buckets.awaiting_engineer_signature.push(run);
    else if (run.status === "awaiting_customer_acknowledgement") buckets.awaiting_customer_acknowledgement.push(run);
    else if (run.status === "complete") buckets.complete.push(run);
  }
  const pendingNotify = store.answers.filter((item) =>
    (item.fieldKey === "hand.notification_status" || item.fieldKey === "oilhand.notification_status")
    && (item.value === "pending" || item.value === "failed"),
  );
  return {
    counts: Object.fromEntries(Object.entries(buckets).map(([key, rows]) => [key, rows.length])),
    blockedUnsafe: store.runs.filter((item) => item.status === "blocked_unsafe" || item.highPriorityFollowUp?.open),
    notificationPending: pendingNotify.length,
    competency: competencyExpiryBoard(),
    runs: store.runs.slice(0, 80).map((item) => ({
      id: item.id,
      jobId: item.jobId,
      costCentreCode: item.costCentreCode,
      status: item.status,
      currentGateKey: item.currentGateKey,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      highPriorityFollowUp: item.highPriorityFollowUp,
    })),
  };
}

export function canFieldCompleteJob(jobId: string, jobCostCentreId: string) {
  const catalogue = findDomesticCostCentre(
    // resolved by caller name if needed
    "",
  );
  void catalogue;
  const run = getActiveRunForCostCentre(jobId, jobCostCentreId);
  if (!run) return { required: false, complete: true };
  return { required: true, complete: run.status === "complete", status: run.status, runId: run.id };
}

export function runBlocksJobComplete(jobId: string, costCentreName?: string, costCentreId?: string) {
  const catalogue = findDomesticCostCentre(costCentreName);
  if (!catalogue) return null;
  const run = costCentreId
    ? getActiveRunForCostCentre(jobId, costCentreId)
    : getDomesticStopGoStore().runs.find((item) => item.jobId === jobId && item.costCentreCode === catalogue.stableCode);
  if (!run) {
    return { blocked: true, message: `Start and complete the ${catalogue.displayName} stop/go before marking the job complete.` };
  }
  if (run.status === "blocked_unsafe") {
    return { blocked: true, message: "Unsafe situation recorded. Complete the warning / make-safe record before finishing the job." };
  }
  if (run.status !== "complete") {
    return { blocked: true, message: `Finish the ${catalogue.displayName} stop/go record before marking the job complete.` };
  }
  return { blocked: false, message: "" };
}
