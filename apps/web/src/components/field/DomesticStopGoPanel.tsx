"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { FileDropZone } from "@/components/FileDropZone";
import { prepareFieldUploadFile } from "@/lib/field/field-photo-client";
import { enqueueOutboxItem, isBrowserOnline, isOfflineOrNetworkError } from "@/lib/field/offline-outbox";
import { isFieldVisible } from "@/lib/domestic-stop-go/rules-engine";
import type {
  AnswerPatch,
  FieldAnswerStatus,
  RuleError,
  WorkflowAnswer,
  WorkflowField,
  WorkflowRun,
  WorkflowTemplate,
} from "@/lib/domestic-stop-go/types";

type Dto = {
  run: WorkflowRun;
  template: WorkflowTemplate;
  currentGate: { key: string; label: string; fieldKeys: string[] } | null;
  progress: { index: number; total: number; label: string };
  answers: WorkflowAnswer[];
  gateErrors: RuleError[];
  completionErrors: RuleError[];
  canAdvance: boolean;
  canComplete: boolean;
  record?: { recordNumber?: string; pdfDocumentId?: string } | null;
  signatures?: Array<{ role: string }>;
};

type Props = {
  scheduleId: string;
  jobId: string;
  engineerName: string;
  onStatus?: (status: WorkflowRun["status"], complete: boolean) => void;
};

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function answerMap(answers: WorkflowAnswer[]) {
  return Object.fromEntries(answers.map((item) => [item.fieldKey, item]));
}

function visibleFields(template: WorkflowTemplate, gateKeys: string[], answers: WorkflowAnswer[]) {
  const map = answerMap(answers);
  return template.fields.filter((field) => gateKeys.includes(field.fieldKey) && isFieldVisible(field, template.rules, map));
}

export function DomesticStopGoPanel({ scheduleId, jobId, engineerName, onStatus }: Props) {
  const [dto, setDto] = useState<Dto | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncState, setSyncState] = useState<"device" | "synced" | "problem">("synced");
  const [busy, setBusy] = useState(false);
  const [confirmChange, setConfirmChange] = useState<WorkflowField | null>(null);
  const saveTimers = useRef<Record<string, number>>({});

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const path = `/api/field/jobs/${encodeURIComponent(scheduleId)}/stop-go`;
      const body = JSON.stringify(payload);
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const json = (await response.json()) as Dto & { error?: string };
        if (!response.ok) throw new Error(json.error || "Save failed.");
        setDto(json);
        setSyncState("synced");
        onStatus?.(json.run.status, json.run.status === "complete");
        return json;
      } catch (err) {
        if (isOfflineOrNetworkError(err) || !isBrowserOnline()) {
          enqueueOutboxItem({
            kind: "checklist",
            jobId,
            path,
            method: "POST",
            body: payload,
            id: String(payload.syncId || uuid()),
          });
          setSyncState("device");
          setNotice("Saved on device — will sync when connected.");
          return null;
        }
        setSyncState("problem");
        throw err;
      }
    },
    [jobId, onStatus, scheduleId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetch(`/api/field/jobs/${encodeURIComponent(scheduleId)}/stop-go`);
        const json = (await loaded.json()) as { enabled?: boolean; dto?: Dto | null; error?: string };
        if (cancelled) return;
        if (json.dto) {
          setDto(json.dto);
          onStatus?.(json.dto.run.status, json.dto.run.status === "complete");
          return;
        }
        const started = await post({ action: "start" });
        if (started) onStatus?.(started.run.status, false);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open stop/go.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onStatus, post, scheduleId]);

  const fields = useMemo(() => {
    if (!dto?.template || !dto.currentGate) return [];
    const gate = dto.template.gates.find((item) => item.key === dto.run.currentGateKey);
    return visibleFields(dto.template, gate?.fieldKeys || dto.currentGate.fieldKeys, dto.answers);
  }, [dto]);

  const map = useMemo(() => answerMap(dto?.answers || []), [dto]);

  function localPatch(field: WorkflowField, patch: Partial<WorkflowAnswer>) {
    setDto((current) => {
      if (!current) return current;
      const existing = current.answers.find((item) => item.fieldKey === field.fieldKey);
      const next: WorkflowAnswer = {
        id: existing?.id || uuid(),
        runId: current.run.id,
        fieldKey: field.fieldKey,
        repeatGroupId: null,
        value: patch.value !== undefined ? patch.value : existing?.value,
        answerStatus: patch.answerStatus || existing?.answerStatus || "answered",
        reason: patch.reason ?? existing?.reason,
        answeredBy: engineerName,
        answeredAt: new Date().toISOString(),
        source: "engineer",
        revision: (existing?.revision || 0) + 1,
      };
      return { ...current, answers: [next, ...current.answers.filter((item) => item.fieldKey !== field.fieldKey)] };
    });
    setSyncState("device");
    window.clearTimeout(saveTimers.current[field.fieldKey]);
    saveTimers.current[field.fieldKey] = window.setTimeout(() => {
      const syncId = uuid();
      void post({
        action: "answers",
        syncId,
        answers: [
          {
            fieldKey: field.fieldKey,
            value: patch.value,
            answerStatus: patch.answerStatus || "answered",
            reason: patch.reason,
            syncId,
            clientRevision: Date.now(),
            deviceTimestamp: new Date().toISOString(),
          } satisfies AnswerPatch,
        ],
      }).catch((err) => setError(err instanceof Error ? err.message : "Could not save."));
    }, 280);
  }

  function applyField(field: WorkflowField, patch: Partial<WorkflowAnswer>) {
    if (field.invalidatesDownstream && (dto?.signatures?.length || 0) > 0) {
      setConfirmChange(field);
      return;
    }
    localPatch(field, patch);
  }

  async function go(direction: "back" | "continue" | "complete" | "unsafe") {
    setBusy(true);
    setError("");
    try {
      if (direction === "back" && dto) {
        const index = dto.progress.index;
        const prev = dto.template.gates[index - 1];
        if (prev) await post({ action: "open-gate", gateKey: prev.key });
        return;
      }
      if (direction === "unsafe") {
        await post({ action: "launch-unsafe" });
        setNotice("Unsafe workflow opened. Complete the warning record before routine finish.");
        return;
      }
      if (direction === "complete") {
        if (!isBrowserOnline()) {
          setNotice("Ready to complete when connected. The certificate is not issued on the device.");
          return;
        }
        const done = await post({ action: "complete" });
        if (done?.record?.recordNumber) setNotice(`Record ${done.record.recordNumber} locked and stored in Job Documents.`);
        return;
      }
      await post({ action: "advance" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue.");
    } finally {
      setBusy(false);
    }
  }

  if (!dto) {
    return <p className="muted">{error || "Opening stop/go…"}</p>;
  }

  const pct = dto.progress.total ? Math.round(((dto.progress.index + 1) / dto.progress.total) * 100) : 0;
  const unsafe = dto.run.status === "blocked_unsafe" || dto.gateErrors.some((item) => item.code === "LAUNCH_LINKED_WORKFLOW");
  const lastGate = dto.progress.index >= dto.progress.total - 1;
  const blocking = dto.gateErrors.filter((item) => item.severity === "blocking");
  const completeIssues = dto.completionErrors.filter((item) => item.severity === "blocking");

  return (
    <div className="stopgo">
      <div className="stopgo-progress" aria-label="Stop/go progress">
        <div className="stopgo-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="stopgo-progress-copy">
        <strong>
          Gate {dto.progress.index + 1} of {dto.progress.total}
        </strong>
        <span>{dto.progress.label}</span>
        <em className={`stopgo-sync is-${syncState}`}>
          {syncState === "synced" ? "Synced" : syncState === "device" ? "Saved on device" : "Sync problem"}
        </em>
      </div>

      {unsafe ? (
        <div className="stopgo-alert" role="alert">
          <ShieldAlert size={20} aria-hidden />
          <div>
            <strong>Safety-critical stop</strong>
            <p>Routine work cannot continue until the warning / make-safe record is completed.</p>
            <button type="button" className="primary-btn" disabled={busy} onClick={() => void go("unsafe")}>
              Open warning record
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="feedback error">{error}</div> : null}
      {notice ? <div className="feedback">{notice}</div> : null}

      {confirmChange ? (
        <div className="stopgo-alert" role="alertdialog">
          <AlertTriangle size={20} aria-hidden />
          <div>
            <strong>This change invalidates later signatures</strong>
            <p>Amending “{confirmChange.label}” will clear downstream sign-off. Continue?</p>
            <div className="field-outcome-buttons">
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  localPatch(confirmChange, { value: map[confirmChange.fieldKey]?.value });
                  setConfirmChange(null);
                }}
              >
                Confirm change
              </button>
              <button type="button" className="ghost-btn" onClick={() => setConfirmChange(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fields.map((field) => (
        <StopGoField
          key={field.fieldKey}
          field={field}
          answer={map[field.fieldKey]}
          error={blocking.find((item) => item.fieldKey === field.fieldKey)?.message}
          engineerName={engineerName}
          disabled={dto.run.status === "complete"}
          onChange={(patch) => applyField(field, patch)}
          onPhoto={async (file) => {
            try {
              const prepared = await prepareFieldUploadFile(file);
              await post({
                action: "evidence",
                fieldKey: field.fieldKey,
                photoName: prepared.name,
                photoContentBase64: prepared.contentBase64,
                photoMimeType: prepared.mimeType,
                syncId: uuid(),
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save photo.");
            }
          }}
          onSignature={async (status, reason) => {
            await post({
              action: "signature",
              signature: {
                role: field.fieldKey.includes("engineer") ? "engineer" : "customer",
                signerName: engineerName,
                status,
                refusalReason: reason,
              },
            });
          }}
        />
      ))}

      {lastGate ? (
        <div className="check-card">
          <h3>Final review</h3>
          <p className="muted">Blocking issues: {completeIssues.length ? completeIssues.map((item) => item.message).join(" ") : "None."}</p>
          {dto.run.status === "complete" ? (
            <p>
              Locked record {dto.record?.recordNumber}. Stored in Job Documents · Forms & Certificates.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="stopgo-nav">
        <button
          type="button"
          className="ghost-btn"
          disabled={busy || dto.progress.index === 0 || dto.run.status === "complete"}
          onClick={() => void go("back")}
        >
          <ChevronLeft size={16} /> Back
        </button>
        {lastGate ? (
          <button
            type="button"
            className="primary-btn"
            disabled={busy || dto.run.status === "complete" || unsafe}
            onClick={() => void go("complete")}
          >
            <CheckCircle2 size={17} /> {isBrowserOnline() ? "Complete record" : "Ready when connected"}
          </button>
        ) : (
          <button
            type="button"
            className="primary-btn"
            disabled={busy || !dto.canAdvance || unsafe || dto.run.status === "complete"}
            onClick={() => void go("continue")}
          >
            Continue <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function StopGoField({
  field,
  answer,
  error,
  engineerName,
  disabled,
  onChange,
  onPhoto,
  onSignature,
}: {
  field: WorkflowField;
  answer?: WorkflowAnswer;
  error?: string;
  engineerName: string;
  disabled: boolean;
  onChange: (patch: Partial<WorkflowAnswer>) => void;
  onPhoto: (file: File) => Promise<void>;
  onSignature: (status: "signed" | "refused_to_sign" | "not_present", reason?: string) => Promise<void>;
}) {
  const value = answer?.value == null ? "" : String(answer.value);
  const status = answer?.answerStatus || "answered";

  return (
    <article className={`check-card${error ? " is-editing" : ""}${field.safetySeverity === "critical" ? " stopgo-critical" : ""}`}>
      <header className="check-card-head">
        <div className="check-card-copy">
          <h3>
            {field.safetySeverity === "critical" ? <AlertTriangle size={16} aria-hidden /> : null} {field.label}
            {field.unit ? ` (${field.unit})` : ""}
          </h3>
          {field.helpText ? <p className="check-card-meta">{field.helpText}</p> : null}
        </div>
      </header>
      {field.dataType === "yes_no" || field.dataType === "choice" ? (
        <div className="stopgo-choices">
          {(field.options || []).map((option) => (
            <button
              key={option.value}
              type="button"
              className={value === option.value ? "stopgo-choice is-on" : "stopgo-choice"}
              disabled={disabled}
              onClick={() => onChange({ value: option.value, answerStatus: "answered" })}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {field.dataType === "text" || field.dataType === "textarea" || field.dataType === "number" || field.dataType === "date" || field.dataType === "time" ? (
        <label className="check-field">
          <span className="visually-hidden">{field.label}</span>
          {field.dataType === "textarea" ? (
            <textarea
              value={value}
              disabled={disabled || field.systemPopulated}
              placeholder={field.placeholder}
              onChange={(event) => onChange({ value: event.target.value, answerStatus: "answered" })}
              rows={3}
            />
          ) : (
            <input
              type={field.inputKind === "date" ? "date" : field.inputKind === "time" ? "time" : "text"}
              inputMode={field.inputKind === "decimal" || field.dataType === "number" ? "decimal" : field.inputKind === "digits" ? "numeric" : "text"}
              value={value}
              disabled={disabled || field.systemPopulated}
              placeholder={field.placeholder}
              onChange={(event) => onChange({ value: event.target.value, answerStatus: "answered" })}
            />
          )}
        </label>
      ) : null}
      {field.dataType === "photo" ? (
        <label className="check-field">
          <span>Photo — camera first</span>
          <FileDropZone
            accept="image/*"
            capture="environment"
            compact
            disabled={disabled}
            label={value ? "Replace photo (camera or click)" : "Take photo"}
            onFiles={(files) => {
              const file = files[0];
              if (file) void onPhoto(file);
            }}
          />
          <span className="check-card-hint muted">{value || "Camera is the default. Gallery is not the only option."}</span>
        </label>
      ) : null}
      {field.dataType === "signature" ? (
        <div className="stopgo-choices">
          <button type="button" className="stopgo-choice" disabled={disabled} onClick={() => void onSignature("signed")}>
            Sign as {engineerName}
          </button>
          {field.fieldKey.includes("customer") ? (
            <>
              <button type="button" className="stopgo-choice" disabled={disabled} onClick={() => void onSignature("refused_to_sign", "Customer refused to sign.")}>
                Refused to sign
              </button>
              <button type="button" className="stopgo-choice" disabled={disabled} onClick={() => void onSignature("not_present", "Customer not present.")}>
                Not present
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {field.allowNa || field.allowNotTested || field.allowUnable || field.allowTbc ? (
        <div className="stopgo-status">
          {field.allowNa ? statusBtn("not_applicable", "N/A") : null}
          {field.allowNotTested ? statusBtn("not_tested", "Not tested") : null}
          {field.allowUnable ? statusBtn("unable_to_access", "Unable to access") : null}
          {field.allowTbc ? statusBtn("tbc", "TBC") : null}
        </div>
      ) : null}
      {(status === "not_applicable" && field.naReasonRequired) || status === "not_tested" || status === "unable_to_access" || status === "tbc" ? (
        <label className="check-field">
          <span>Reason</span>
          <input
            value={answer?.reason || ""}
            disabled={disabled}
            onChange={(event) => onChange({ answerStatus: status, reason: event.target.value, value: answer?.value })}
          />
        </label>
      ) : null}
      {error ? <p className="stopgo-field-error">{error}</p> : null}
    </article>
  );

  function statusBtn(next: FieldAnswerStatus, label: string) {
    return (
      <button
        type="button"
        className={status === next ? "stopgo-choice is-on" : "stopgo-choice"}
        disabled={disabled}
        onClick={() => onChange({ answerStatus: next, value: answer?.value, reason: answer?.reason })}
      >
        {label}
      </button>
    );
  }
}
