"use client";

import { useMemo, useRef, useState } from "react";
import { SignaturePad } from "@/components/SignaturePad";
import {
  DAYWORK_TRADE_OPTIONS,
  DAYWORK_WEEKDAY_OPTIONS,
  dayworkDraftFromRecord,
  dayworkRecordFromDraft,
  defaultDayworkWeekEndingUk,
  isDayworkSubmittedToCore,
  isValidDayworkClientEmail,
  totalDayworkLabourHours,
  validateDayworkSheetDraft,
  type DayworkAccountRecord,
  type DayworkLabourDay,
  type DayworkLineItem,
  type DayworkSheetDraft,
} from "@/lib/daywork-account-form";
import { isoDateToUk, toUkDateDisplay, toUkDateTimeDisplay, ukDateToIso } from "@/lib/uk-date";

type Props = {
  /** Field schedule id — saves via /api/field/jobs/.../daywork */
  scheduleId?: string;
  /** Core job id — saves via /api/jobs/.../daywork when scheduleId is absent */
  jobId?: string;
  costCentreId?: string;
  engineerName: string;
  initialRecord?: DayworkAccountRecord | null;
  requestHeaders?: HeadersInit;
  onSaved?: (record: DayworkAccountRecord) => void;
  onCancel?: () => void;
  /**
   * Force locked view. Field sheets auto-lock after dual sign-off / submit to Core.
   * Core edit path should leave this unset (office can still amend).
   */
  locked?: boolean;
};

function updateRow<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

function shoutError(message: string) {
  if (typeof window !== "undefined") {
    window.alert(message);
  }
}

export function DayworkSheetForm({
  scheduleId,
  jobId,
  costCentreId,
  engineerName,
  initialRecord,
  requestHeaders,
  onSaved,
  onCancel,
  locked: lockedProp,
}: Props) {
  const [draft, setDraft] = useState<DayworkSheetDraft>(() => {
    const base = dayworkDraftFromRecord(initialRecord, {
      labourName: engineerName,
      labourTrade: "Plumber",
    });
    if (!base.weekEnding.trim()) {
      base.weekEnding = defaultDayworkWeekEndingUk();
    }
    if (!base.labourName.trim() && engineerName.trim()) {
      base.labourName = engineerName;
    }
    if (!base.plumberSignerName.trim() && (base.labourName || engineerName)) {
      base.plumberSignerName = base.labourName || engineerName;
    }
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [sendingCopy, setSendingCopy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submittedRecord, setSubmittedRecord] = useState<DayworkAccountRecord | null>(
    isDayworkSubmittedToCore(initialRecord) ? initialRecord || null : null,
  );
  const errorRef = useRef<HTMLDivElement | null>(null);

  const saveViaCore = !scheduleId && Boolean(jobId);
  // Field: lock after submit. Core office edit stays open unless locked is forced.
  const locked =
    lockedProp === true ||
    (Boolean(scheduleId) && (isDayworkSubmittedToCore(submittedRecord) || isDayworkSubmittedToCore(initialRecord)));

  const totalHours = useMemo(
    () =>
      totalDayworkLabourHours({
        labourDaysJson: JSON.stringify(draft.labourDays),
        populatedFrom: "engineer-app",
      }),
    [draft.labourDays],
  );

  const weekEndingIso = ukDateToIso(draft.weekEnding) || "";
  const signedAtLabel = toUkDateTimeDisplay(
    submittedRecord?.completedAt || initialRecord?.completedAt || "",
  );

  function setLabourDay(index: number, patch: Partial<DayworkLabourDay>) {
    if (locked) return;
    setDraft((current) => ({ ...current, labourDays: updateRow(current.labourDays, index, patch) }));
  }

  function setMaterial(index: number, patch: Partial<DayworkLineItem>) {
    if (locked) return;
    setDraft((current) => ({ ...current, materials: updateRow(current.materials, index, patch) }));
  }

  function setPlant(index: number, patch: Partial<DayworkLineItem>) {
    if (locked) return;
    setDraft((current) => ({ ...current, plant: updateRow(current.plant, index, patch) }));
  }

  function showFailure(message: string) {
    setError(message);
    setNotice("");
    shoutError(message);
    window.setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  async function saveSheet() {
    if (locked) {
      showFailure("This Daywork is locked — it was already submitted to Core. Office can edit it in Core.");
      return;
    }
    const validationError = validateDayworkSheetDraft(draft);
    if (validationError) {
      showFailure(validationError);
      return;
    }
    if (!scheduleId && !jobId) {
      showFailure("Missing job or schedule — cannot save Daywork sheet.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      // /api/health is public — it never proves the session. Use /api/auth/me.
      const sessionCheck = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
      if (sessionCheck.status === 401) {
        throw new Error("Not signed in — open /login on this same site, sign in, then Save and finish again.");
      }

      const record = dayworkRecordFromDraft(draft, saveViaCore ? "core" : "engineer-app");
      const endpoint = scheduleId
        ? `/api/field/jobs/${encodeURIComponent(scheduleId)}/daywork`
        : `/api/jobs/${encodeURIComponent(jobId!)}/daywork`;
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(requestHeaders || {}),
        },
        body: JSON.stringify({
          action: "save",
          record,
          createdBy: engineerName,
          ...(costCentreId ? { costCentreId } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        record?: DayworkAccountRecord;
        persisted?: boolean;
        materialsCount?: number;
        hasClientName?: boolean;
        hasSignatures?: boolean;
        storeSheetCount?: number;
        jobId?: string;
        costCentreId?: string;
        locked?: boolean;
      };
      if (response.status === 401) {
        throw new Error("Not signed in — open /login on this same site, sign in, then Save and finish again.");
      }
      if (response.status === 409 || body.locked) {
        const lockedRecord = body.record || record;
        setSubmittedRecord(lockedRecord);
        setDraft(
          dayworkDraftFromRecord(lockedRecord, {
            labourName: engineerName,
            labourTrade: "Plumber",
          }),
        );
        throw new Error(
          body.error ||
            "This Daywork is locked — already submitted to Core. Only office can edit it in Core.",
        );
      }
      if (!response.ok) throw new Error(body.error || "Could not save daywork sheet.");
      if (!body.persisted || !body.hasSignatures) {
        throw new Error(
          body.error ||
            "Save did not stick on the live store — try again. If it keeps failing, sign out/in and retry.",
        );
      }
      const saved = body.record || record;
      setSubmittedRecord(saved);
      setDraft(
        dayworkDraftFromRecord(saved, {
          labourName: engineerName,
          labourTrade: "Plumber",
          clientEmail: draft.clientEmail,
        }),
      );
      const okMessage = scheduleId
        ? `Submitted to Core and locked on Field · ${body.materialsCount ?? 0} materials. Office can edit in Core → Variations → Daywork account.`
        : `Saved to Core · ${body.materialsCount ?? 0} materials · client ${
            body.hasClientName ? "named" : "missing"
          } · signatures OK · sheets on server: ${body.storeSheetCount ?? "?"}.`;
      setNotice(
        draft.clientEmail.trim()
          ? `${okMessage} You can email a hours/materials copy to ${draft.clientEmail.trim()} below.`
          : `${okMessage} Add a client email below to send them a hours/materials copy.`,
      );
      shoutError(
        scheduleId
          ? "Daywork submitted to Core.\n\nThis sheet is now locked on Field.\nAdd the client email and tap Email client copy if they need a PDF."
          : `Daywork saved to Core.\n\nMaterials: ${body.materialsCount ?? 0}\nOpen Core → this job → Cost centres → Variations → Daywork account.`,
      );
      onSaved?.(saved);
    } catch (saveError) {
      showFailure(saveError instanceof Error ? saveError.message : "Could not save daywork sheet.");
    } finally {
      setSaving(false);
    }
  }

  async function sendClientCopy() {
    if (!scheduleId && !jobId) {
      showFailure("Missing job or schedule — cannot email Daywork copy.");
      return;
    }
    const email = draft.clientEmail.trim();
    if (!isValidDayworkClientEmail(email)) {
      showFailure("Enter a valid client email address first.");
      return;
    }
    if (!locked && !isDayworkSubmittedToCore(submittedRecord)) {
      showFailure("Save and finish the Daywork (both signatures) before emailing a client copy.");
      return;
    }
    setSendingCopy(true);
    setError("");
    setNotice("");
    try {
      const endpoint = scheduleId
        ? `/api/field/jobs/${encodeURIComponent(scheduleId)}/daywork`
        : `/api/jobs/${encodeURIComponent(jobId!)}/daywork`;
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(requestHeaders || {}),
        },
        body: JSON.stringify({
          action: "send_copy",
          clientEmail: email,
          createdBy: engineerName,
          ...(costCentreId ? { costCentreId } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        clientEmail?: string;
        record?: DayworkAccountRecord;
      };
      if (!response.ok) throw new Error(body.error || "Could not email Daywork copy.");
      if (body.record) {
        setSubmittedRecord(body.record);
        setDraft((current) => ({
          ...current,
          clientEmail: body.record?.clientEmail || email,
        }));
      }
      setNotice(`Client copy emailed to ${body.clientEmail || email} (hours and materials only — no costs).`);
    } catch (sendError) {
      showFailure(sendError instanceof Error ? sendError.message : "Could not email Daywork copy.");
    } finally {
      setSendingCopy(false);
    }
  }

  return (
    <div className={locked ? "daywork-sheet-form stack is-locked" : "daywork-sheet-form stack"}>
      {locked ? (
        <div className="feedback daywork-locked-banner" role="status">
          Locked — submitted to Core
          {signedAtLabel ? ` · ${signedAtLabel}` : ""}. View only on Field; office can edit in Core.
        </div>
      ) : (
        <p className="checklist-intro muted">
          {saveViaCore
            ? "Enter the Daywork Account in Core — materials, printed names and both signatures. This writes to the same live store Field uses."
            : "This Field sheet saves straight into Core → Variations → Daywork account. After Save and finish it locks on Field; office can still edit in Core."}
        </p>
      )}
      {error ? (
        <div className="feedback error" ref={errorRef} role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <div className="feedback">{notice}</div> : null}

      <label className="daywork-field">
        <span>Description of works</span>
        <textarea
          rows={3}
          value={draft.description}
          placeholder="Describe the reactive / variation works…"
          readOnly={locked}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
        />
      </label>

      <label className="daywork-field">
        <span>Week ending</span>
        <input
          type="date"
          value={weekEndingIso}
          readOnly={locked}
          disabled={locked}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              weekEnding: event.target.value ? isoDateToUk(event.target.value) : "",
            }))
          }
        />
        {draft.weekEnding ? <small>{toUkDateDisplay(draft.weekEnding)}</small> : null}
      </label>

      <label className="daywork-field">
        <span>Variation reference</span>
        <input
          type="text"
          value={draft.voReference}
          placeholder="Optional V.O. / variation ref"
          readOnly={locked}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, voReference: event.target.value }))}
        />
      </label>

      <label className="daywork-field">
        <span>Operative name</span>
        <input
          type="text"
          value={draft.labourName}
          placeholder="e.g. Chris Lawson"
          readOnly={locked}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, labourName: event.target.value }))}
        />
      </label>

      <label className="daywork-field">
        <span>Labour trade</span>
        <select
          value={draft.labourTrade}
          disabled={locked}
          onChange={(event) => setDraft((current) => ({ ...current, labourTrade: event.target.value }))}
        >
          {DAYWORK_TRADE_OPTIONS.map((trade) => (
            <option key={trade} value={trade}>
              {trade}
            </option>
          ))}
        </select>
      </label>

      <section className="daywork-repeat-block">
        <div className="daywork-repeat-head">
          <strong>Labour hours</strong>
          <span>{totalHours ? `${totalHours} hrs total` : "Enter hours on the days worked"}</span>
        </div>
        <div className="daywork-week-grid">
          {draft.labourDays.map((row, index) => {
            const label =
              DAYWORK_WEEKDAY_OPTIONS.find((day) => day.id === row.day)?.label || row.day || `Day ${index + 1}`;
            return (
              <label className="daywork-week-cell" key={`labour-${row.day || index}`}>
                <span>{label.slice(0, 3)}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  min="0"
                  placeholder="0"
                  aria-label={`Hours for ${label}`}
                  value={row.hours}
                  readOnly={locked}
                  disabled={locked}
                  onChange={(event) => setLabourDay(index, { hours: event.target.value })}
                />
              </label>
            );
          })}
        </div>
      </section>

      <section className="daywork-repeat-block">
        <div className="daywork-repeat-head">
          <strong>Materials</strong>
          <span>Description + qty</span>
        </div>
        {draft.materials.map((row, index) => (
          <div className="daywork-repeat-row is-wide" key={`mat-${index}`}>
            <input
              type="text"
              placeholder="Material description"
              aria-label={`Material ${index + 1} description`}
              value={row.description}
              readOnly={locked}
              disabled={locked}
              onChange={(event) => setMaterial(index, { description: event.target.value })}
            />
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="Qty"
              aria-label={`Material ${index + 1} quantity`}
              value={row.qty}
              readOnly={locked}
              disabled={locked}
              onChange={(event) => setMaterial(index, { qty: event.target.value })}
            />
            {!locked && draft.materials.length > 1 ? (
              <button
                type="button"
                className="daywork-remove"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    materials: current.materials.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {!locked ? (
          <button
            type="button"
            className="daywork-add"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                materials: [...current.materials, { description: "", qty: "" }],
              }))
            }
          >
            + Add material
          </button>
        ) : null}
      </section>

      <section className="daywork-repeat-block">
        <div className="daywork-repeat-head">
          <strong>Plant</strong>
          <span>Description + qty</span>
        </div>
        {draft.plant.map((row, index) => (
          <div className="daywork-repeat-row is-wide" key={`plant-${index}`}>
            <input
              type="text"
              placeholder="Plant description"
              aria-label={`Plant ${index + 1} description`}
              value={row.description}
              readOnly={locked}
              disabled={locked}
              onChange={(event) => setPlant(index, { description: event.target.value })}
            />
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="Qty"
              aria-label={`Plant ${index + 1} quantity`}
              value={row.qty}
              readOnly={locked}
              disabled={locked}
              onChange={(event) => setPlant(index, { qty: event.target.value })}
            />
            {!locked && draft.plant.length > 1 ? (
              <button
                type="button"
                className="daywork-remove"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    plant: current.plant.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {!locked ? (
          <button
            type="button"
            className="daywork-add"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                plant: [...current.plant, { description: "", qty: "" }],
              }))
            }
          >
            + Add plant
          </button>
        ) : null}
      </section>

      <section className="daywork-signoff-block">
        <strong>Sign-off</strong>
        <p className="muted">
          {locked
            ? "Signatures locked with the submitted sheet."
            : "Draw the signature and type the printed name — names are needed because signatures can be hard to read."}
        </p>
        <label className="daywork-field">
          <span>Plumber / contractor printed name</span>
          <input
            type="text"
            value={draft.plumberSignerName}
            placeholder="Full name"
            readOnly={locked}
            disabled={locked}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                plumberSignerName: event.target.value,
                labourName: current.labourName || event.target.value,
              }))
            }
          />
        </label>
        <SignaturePad
          label="Plumber / contractor signature"
          value={draft.plumberSignature}
          readOnly={locked}
          onChange={(dataUrl) => setDraft((current) => ({ ...current, plumberSignature: dataUrl }))}
        />
        <label className="daywork-field">
          <span>Client / Clerk of Works printed name</span>
          <input
            type="text"
            value={draft.clientSignerName}
            placeholder="Full name"
            readOnly={locked}
            disabled={locked}
            onChange={(event) => setDraft((current) => ({ ...current, clientSignerName: event.target.value }))}
          />
        </label>
        <SignaturePad
          label="Client / Clerk of Works signature"
          value={draft.clientSignature}
          readOnly={locked}
          onChange={(dataUrl) => setDraft((current) => ({ ...current, clientSignature: dataUrl }))}
        />
        <label className="daywork-field">
          <span>Client email (for copy of this sheet)</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={draft.clientEmail}
            placeholder="site.manager@example.com"
            onChange={(event) => setDraft((current) => ({ ...current, clientEmail: event.target.value }))}
          />
        </label>
        <p className="muted" style={{ margin: "0 0 8px" }}>
          Optional. After Save and finish, email them a PDF of hours and materials only — no rates or costs.
        </p>
      </section>

      <div className="daywork-form-actions">
        {onCancel ? (
          <button type="button" className="secondary-btn" disabled={saving || sendingCopy} onClick={onCancel}>
            {locked ? "Back" : "Back to job checklist"}
          </button>
        ) : null}
        {locked ? (
          <button
            type="button"
            className="primary-btn daywork-save"
            disabled={saving || sendingCopy || !draft.clientEmail.trim()}
            onClick={() => void sendClientCopy()}
          >
            {sendingCopy ? "Sending…" : "Email client copy"}
          </button>
        ) : (
          <button type="button" className="primary-btn daywork-save" disabled={saving || sendingCopy} onClick={() => void saveSheet()}>
            {saving ? "Saving…" : "Save and finish"}
          </button>
        )}
      </div>
    </div>
  );
}
