"use client";

import { useMemo, useRef, useState } from "react";
import { SignaturePad } from "@/components/SignaturePad";
import {
  DAYWORK_TRADE_OPTIONS,
  DAYWORK_WEEKDAY_OPTIONS,
  dayworkDraftFromRecord,
  dayworkRecordFromDraft,
  defaultDayworkWeekEndingUk,
  totalDayworkLabourHours,
  validateDayworkSheetDraft,
  type DayworkAccountRecord,
  type DayworkLabourDay,
  type DayworkLineItem,
  type DayworkSheetDraft,
} from "@/lib/daywork-account-form";
import { isoDateToUk, toUkDateDisplay, ukDateToIso } from "@/lib/uk-date";

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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const errorRef = useRef<HTMLDivElement | null>(null);

  const totalHours = useMemo(
    () =>
      totalDayworkLabourHours({
        labourDaysJson: JSON.stringify(draft.labourDays),
        populatedFrom: "engineer-app",
      }),
    [draft.labourDays],
  );

  const weekEndingIso = ukDateToIso(draft.weekEnding) || "";
  const saveViaCore = !scheduleId && Boolean(jobId);

  function setLabourDay(index: number, patch: Partial<DayworkLabourDay>) {
    setDraft((current) => ({ ...current, labourDays: updateRow(current.labourDays, index, patch) }));
  }

  function setMaterial(index: number, patch: Partial<DayworkLineItem>) {
    setDraft((current) => ({ ...current, materials: updateRow(current.materials, index, patch) }));
  }

  function setPlant(index: number, patch: Partial<DayworkLineItem>) {
    setDraft((current) => ({ ...current, plant: updateRow(current.plant, index, patch) }));
  }

  function showFailure(message: string) {
    setError(message);
    setNotice("");
    shoutError(message);
    window.setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  async function saveSheet() {
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
      };
      if (response.status === 401) {
        throw new Error("Not signed in — open /login on this same site, sign in, then Save and finish again.");
      }
      if (!response.ok) throw new Error(body.error || "Could not save daywork sheet.");
      if (!body.persisted || !body.hasSignatures) {
        throw new Error(
          body.error ||
            "Save did not stick on the live store — try again. If it keeps failing, sign out/in and retry.",
        );
      }
      const okMessage = `Saved to Core · ${body.materialsCount ?? 0} materials · client ${
        body.hasClientName ? "named" : "missing"
      } · signatures OK · sheets on server: ${body.storeSheetCount ?? "?"}. Open Core → Variations → Daywork account.`;
      setNotice(okMessage);
      shoutError(
        `Daywork saved to Core.\n\nMaterials: ${body.materialsCount ?? 0}\nOpen Core → this job → Cost centres → Variations → Daywork account.`,
      );
      if (body.record) onSaved?.(body.record);
      else onSaved?.(record);
    } catch (saveError) {
      showFailure(saveError instanceof Error ? saveError.message : "Could not save daywork sheet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="daywork-sheet-form stack">
      <p className="checklist-intro muted">
        {saveViaCore
          ? "Enter the Daywork Account in Core — materials, printed names and both signatures. This writes to the same live store Field uses."
          : "This Field sheet saves straight into Core → Variations → Daywork account. Tap Save and finish when both signatures are drawn."}
      </p>
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
          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
        />
      </label>

      <label className="daywork-field">
        <span>Week ending</span>
        <input
          type="date"
          value={weekEndingIso}
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
          onChange={(event) => setDraft((current) => ({ ...current, voReference: event.target.value }))}
        />
      </label>

      <label className="daywork-field">
        <span>Operative name</span>
        <input
          type="text"
          value={draft.labourName}
          placeholder="e.g. Chris Lawson"
          onChange={(event) => setDraft((current) => ({ ...current, labourName: event.target.value }))}
        />
      </label>

      <label className="daywork-field">
        <span>Labour trade</span>
        <select
          value={draft.labourTrade}
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
              onChange={(event) => setMaterial(index, { qty: event.target.value })}
            />
            {draft.materials.length > 1 ? (
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
              onChange={(event) => setPlant(index, { qty: event.target.value })}
            />
            {draft.plant.length > 1 ? (
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
      </section>

      <section className="daywork-signoff-block">
        <strong>Sign-off</strong>
        <p className="muted">Draw the signature and type the printed name — names are needed because signatures can be hard to read.</p>
        <label className="daywork-field">
          <span>Plumber / contractor printed name</span>
          <input
            type="text"
            value={draft.plumberSignerName}
            placeholder="Full name"
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
          onChange={(dataUrl) => setDraft((current) => ({ ...current, plumberSignature: dataUrl }))}
        />
        <label className="daywork-field">
          <span>Client / Clerk of Works printed name</span>
          <input
            type="text"
            value={draft.clientSignerName}
            placeholder="Full name"
            onChange={(event) => setDraft((current) => ({ ...current, clientSignerName: event.target.value }))}
          />
        </label>
        <SignaturePad
          label="Client / Clerk of Works signature"
          value={draft.clientSignature}
          onChange={(dataUrl) => setDraft((current) => ({ ...current, clientSignature: dataUrl }))}
        />
      </section>

      <div className="daywork-form-actions">
        {onCancel ? (
          <button type="button" className="secondary-btn" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="button" className="primary-btn daywork-save" disabled={saving} onClick={() => void saveSheet()}>
          {saving ? "Saving…" : "Save and finish"}
        </button>
      </div>
    </div>
  );
}
