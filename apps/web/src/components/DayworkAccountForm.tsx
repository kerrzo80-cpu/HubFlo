"use client";

import { useEffect, useMemo, useState } from "react";
import { SignatureImage } from "@/components/SignaturePad";
import {
  buildDayworkFormSections,
  dayworkAccountTotals,
  dayworkLineAmount,
  parseDayworkLineItems,
  serialiseDayworkLineItems,
  type DayworkAccountContext,
  type DayworkAccountRecord,
  type DayworkLineItem,
} from "@/lib/daywork-account-form";

export type DayworkOfficeCostsPayload = {
  labourRate: string;
  markupPercent: string;
  materialsJson: string;
  plantJson: string;
  materialsCost: string;
  plantCost: string;
};

type Props = {
  context: DayworkAccountContext;
  /** When set, office can price labour rate + each material/plant line before valuations. */
  onSaveOfficeCosts?: (costs: DayworkOfficeCostsPayload) => Promise<void> | void;
  savingOfficeCosts?: boolean;
  /** Opens the valuation PDF preview (same file attached to valuations). */
  onPreviewPdf?: () => void | Promise<void>;
  previewingPdf?: boolean;
};

function money(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "£0.00";
  return value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

export function DayworkAccountForm({
  context,
  onSaveOfficeCosts,
  savingOfficeCosts,
  onPreviewPdf,
  previewingPdf,
}: Props) {
  const sections = buildDayworkFormSections(context);
  const totals = dayworkAccountTotals(context.record);
  const filledCount = sections.reduce(
    (sum, section) => sum + section.rows.filter((row) => row.filled).length,
    0,
  );
  const totalCount = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const bothSigned = Boolean(
    context.record?.plumberSignature?.trim() && context.record?.clientSignature?.trim(),
  );

  const [labourRate, setLabourRate] = useState(context.record?.labourRate || "");
  const [markupPercent, setMarkupPercent] = useState(context.record?.markupPercent || "");
  const [materials, setMaterials] = useState<DayworkLineItem[]>(() =>
    parseDayworkLineItems(context.record?.materialsJson),
  );
  const [plant, setPlant] = useState<DayworkLineItem[]>(() => parseDayworkLineItems(context.record?.plantJson));

  useEffect(() => {
    setLabourRate(context.record?.labourRate || "");
    setMarkupPercent(context.record?.markupPercent || "");
    setMaterials(parseDayworkLineItems(context.record?.materialsJson));
    setPlant(parseDayworkLineItems(context.record?.plantJson));
  }, [
    context.record?.labourRate,
    context.record?.markupPercent,
    context.record?.materialsJson,
    context.record?.plantJson,
    context.record?.completedAt,
  ]);

  const liveTotals = useMemo(
    () =>
      dayworkAccountTotals({
        populatedFrom: "core",
        labourHours: context.record?.labourHours,
        labourDaysJson: context.record?.labourDaysJson,
        labourRate,
        markupPercent,
        materialsJson: serialiseDayworkLineItems(materials),
        plantJson: serialiseDayworkLineItems(plant),
      }),
    [context.record?.labourDaysJson, context.record?.labourHours, labourRate, markupPercent, materials, plant],
  );

  function updateMaterial(index: number, patch: Partial<DayworkLineItem>) {
    setMaterials((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updatePlant(index: number, patch: Partial<DayworkLineItem>) {
    setPlant((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function saveCosts() {
    if (!onSaveOfficeCosts) return;
    const materialsJson = serialiseDayworkLineItems(materials);
    const plantJson = serialiseDayworkLineItems(plant);
    const nextTotals = dayworkAccountTotals({
      populatedFrom: "core",
      labourDaysJson: context.record?.labourDaysJson,
      labourHours: context.record?.labourHours,
      labourRate,
      markupPercent,
      materialsJson,
      plantJson,
    });
    await onSaveOfficeCosts({
      labourRate,
      markupPercent,
      materialsJson,
      plantJson,
      materialsCost: nextTotals.materials ? String(Math.round(nextTotals.materials * 100) / 100) : "",
      plantCost: nextTotals.plant ? String(Math.round(nextTotals.plant * 100) / 100) : "",
    });
  }

  return (
    <article className="daywork-account-form">
      <header className="daywork-account-masthead">
        <div>
          <p className="daywork-account-kicker">Errol Watson Group style sheet</p>
          <h3>Daywork Account</h3>
          <p>
            Field captures labour hours, materials used and dual sign-off. Office sets labour rate and a unit price
            for each material / plant line before valuations.
          </p>
        </div>
        <div className="daywork-account-ref">
          <strong>{context.jobRef}</strong>
          <span>
            {filledCount}/{totalCount} fields ·{" "}
            {totals.labourHours ? `${totals.labourHours} hrs` : "No hours yet"}
            {liveTotals.total
              ? ` · ${liveTotals.total.toLocaleString("en-GB", { style: "currency", currency: "GBP" })}`
              : ""}
          </span>
          <span className={bothSigned ? "daywork-sign-status ready" : "daywork-sign-status pending"}>
            {bothSigned ? "Plumber + client signed" : "Awaiting dual sign-off"}
          </span>
        </div>
      </header>

      {onSaveOfficeCosts ? (
        <section className="daywork-office-pricing">
          <h4>Office pricing</h4>
          <p>Set labour £/hr and a unit price against each Field material / plant line.</p>
          <div className="daywork-office-pricing-grid">
            <label>
              <span>Labour rate (£/hr)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={labourRate}
                onChange={(event) => setLabourRate(event.target.value)}
              />
            </label>
            <label>
              <span>Add % on mats/plant</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={markupPercent}
                onChange={(event) => setMarkupPercent(event.target.value)}
              />
            </label>
          </div>

          <div className="daywork-line-pricing">
            <strong>Materials — unit price each</strong>
            {materials.length === 0 ? (
              <p className="muted">No materials from Field yet.</p>
            ) : (
              materials.map((row, index) => (
                <div className="daywork-line-pricing-row" key={`mat-price-${index}`}>
                  <span>
                    {row.description || "Material"}
                    {row.qty ? ` × ${row.qty}` : ""}
                  </span>
                  <label>
                    <span>£ each</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={row.unitCost || ""}
                      onChange={(event) => updateMaterial(index, { unitCost: event.target.value })}
                      aria-label={`${row.description || "Material"} unit price`}
                    />
                  </label>
                  <strong>{money(dayworkLineAmount(row))}</strong>
                </div>
              ))
            )}
          </div>

          <div className="daywork-line-pricing">
            <strong>Plant — unit price each</strong>
            {plant.length === 0 ? (
              <p className="muted">No plant from Field yet.</p>
            ) : (
              plant.map((row, index) => (
                <div className="daywork-line-pricing-row" key={`plant-price-${index}`}>
                  <span>
                    {row.description || "Plant"}
                    {row.qty ? ` × ${row.qty}` : ""}
                  </span>
                  <label>
                    <span>£ each</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={row.unitCost || ""}
                      onChange={(event) => updatePlant(index, { unitCost: event.target.value })}
                      aria-label={`${row.description || "Plant"} unit price`}
                    />
                  </label>
                  <strong>{money(dayworkLineAmount(row))}</strong>
                </div>
              ))
            )}
          </div>

          <div className="daywork-office-pricing-actions">
            <strong>
              {liveTotals.labourHours ? `${liveTotals.labourHours} hrs from Field` : "No Field hours yet"}
              {` · mats ${money(liveTotals.materials)} · plant ${money(liveTotals.plant)} · total ${money(liveTotals.total)}`}
            </strong>
            <button
              className="simpro-blue-button"
              type="button"
              disabled={Boolean(savingOfficeCosts)}
              onClick={() => void saveCosts()}
            >
              {savingOfficeCosts ? "Saving…" : "Save office costs"}
            </button>
          </div>
        </section>
      ) : null}

      {sections.map((section) => (
        <section className="daywork-account-section" key={section.section}>
          <h4>{section.section}</h4>
          <table>
            <tbody>
              {section.rows.map((row) => {
                const isSignature = row.key === "plumber" || row.key === "client";
                return (
                  <tr key={row.key} className={row.filled ? "filled" : "empty"}>
                    <th>{row.label}</th>
                    <td>
                      {isSignature ? (
                        <SignatureImage value={row.value === "—" ? "" : row.value} alt={row.label} />
                      ) : (
                        row.value
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <footer className="daywork-account-footer">
        <p>
          Signed sheets land in job → Cost centres → Variations. A Daywork PDF (with printed names + signatures)
          attaches when you submit the valuation.
        </p>
        {onPreviewPdf ? (
          <button
            className="simpro-grey-button"
            type="button"
            disabled={Boolean(previewingPdf)}
            onClick={() => void onPreviewPdf()}
          >
            {previewingPdf ? "Opening PDF…" : "Preview valuation PDF"}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

export type { DayworkAccountRecord };
