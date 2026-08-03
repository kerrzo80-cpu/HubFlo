"use client";

import { useMemo, useState } from "react";
import { SignaturePad } from "@/components/SignaturePad";
import {
  DAYWORK_TRADE_OPTIONS,
  DAYWORK_WEEKDAY_OPTIONS,
  dayworkDraftFromRecord,
  dayworkRecordFromDraft,
  totalDayworkLabourHours,
  validateDayworkSheetDraft,
  type DayworkAccountRecord,
  type DayworkLabourDay,
  type DayworkLineItem,
  type DayworkSheetDraft,
} from "@/lib/daywork-account-form";
import { isoDateToUk, toUkDateDisplay, ukDateToIso } from "@/lib/uk-date";

type Props = {
  scheduleId: string;
  engineerName: string;
  initialRecord?: DayworkAccountRecord | null;
  onSaved?: (record: DayworkAccountRecord) => void;
};

function updateRow<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

export function DayworkSheetForm({ scheduleId, engineerName, initialRecord, onSaved }: Props) {
  const [draft, setDraft] = useState<DayworkSheetDraft>(() =>
    dayworkDraftFromRecord(initialRecord, { labourName: engineerName, labourTrade: "Plumber" }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const totalHours = useMemo(
    () =>
      totalDayworkLabourHours({
        labourDaysJson: JSON.stringify(draft.labourDays),
        populatedFrom: "engineer-app",
      }),
    [draft.labourDays],
  );

  const weekEndingIso = ukDateToIso(draft.weekEnding) || "";

  function setLabourDay(index: number, patch: Partial<DayworkLabourDay>) {
    setDraft((current) => ({ ...current, labourDays: updateRow(current.labourDays, index, patch) }));
  }

  function setMaterial(index: number, patch: Partial<DayworkLineItem>) {
    setDraft((current) => ({ ...current, materials: updateRow(current.materials, index, patch) }));
  }

  function setPlant(index: number, patch: Partial<DayworkLineItem>) {
    setDraft((current) => ({ ...current, plant: updateRow(current.plant, index, patch) }));
  }

  async function saveSheet() {
    const validationError = validateDayworkSheetDraft(draft);
    if (validationError) {
      setError(validationError);
      setNotice("");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const record = dayworkRecordFromDraft(draft, "engineer-app");
      const response = await fetch(`/api/field/jobs/${encodeURIComponent(scheduleId)}/daywork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", record, createdBy: engineerName }),
      });
      const body = (await response.json()) as { error?: string; record?: DayworkAccountRecord };
      if (!response.ok) throw new Error(body.error || "Could not save daywork sheet.");
      setNotice(
        body.record?.plumberSignature
          ? "Daywork Account saved — signatures and materials are now in Core Variations."
          : "Daywork Account saved to Core Variations.",
      );
      if (body.record) onSaved?.(body.record);
      else onSaved?.(record);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save daywork sheet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="daywork-sheet-form stack">
      <p className="checklist-intro muted">
        Fill the Daywork Account — rates and markups are added by the office in Core.
      </p>
      {error ? <div className="feedback error">{error}</div> : null}
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
          <span>{totalHours ? `${totalHours} hrs total` : "Add day + hours"}</span>
        </div>
        {draft.labourDays.map((row, index) => (
          <div className="daywork-repeat-row" key={`labour-${index}`}>
            <select
              aria-label={`Labour day ${index + 1}`}
              value={row.day}
              onChange={(event) => setLabourDay(index, { day: event.target.value })}
            >
              {DAYWORK_WEEKDAY_OPTIONS.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              inputMode="decimal"
              step="0.25"
              min="0"
              placeholder="Hours"
              aria-label={`Hours for ${row.day || "day"}`}
              value={row.hours}
              onChange={(event) => setLabourDay(index, { hours: event.target.value })}
            />
            {draft.labourDays.length > 1 ? (
              <button
                type="button"
                className="daywork-remove"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    labourDays: current.labourDays.filter((_, i) => i !== index),
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
              labourDays: [...current.labourDays, { day: "Tue", hours: "" }],
            }))
          }
        >
          + Add another day
        </button>
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

      <button type="button" className="primary-btn daywork-save" disabled={saving} onClick={() => void saveSheet()}>
        {saving ? "Saving…" : "Save Daywork Account"}
      </button>
    </div>
  );
}
