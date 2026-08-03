"use client";

import { useEffect, useState } from "react";
import { SignatureImage } from "@/components/SignaturePad";
import {
  buildDayworkFormSections,
  dayworkAccountTotals,
  type DayworkAccountContext,
  type DayworkAccountRecord,
} from "@/lib/daywork-account-form";

type OfficeCosts = {
  labourRate: string;
  materialsCost: string;
  plantCost: string;
  markupPercent: string;
};

type Props = {
  context: DayworkAccountContext;
  /** When set, office can price labour rate + materials/plant £ before valuations. */
  onSaveOfficeCosts?: (costs: OfficeCosts) => Promise<void> | void;
  savingOfficeCosts?: boolean;
};

export function DayworkAccountForm({ context, onSaveOfficeCosts, savingOfficeCosts }: Props) {
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
  const [costs, setCosts] = useState<OfficeCosts>({
    labourRate: context.record?.labourRate || "",
    materialsCost: context.record?.materialsCost || "",
    plantCost: context.record?.plantCost || "",
    markupPercent: context.record?.markupPercent || "",
  });

  useEffect(() => {
    setCosts({
      labourRate: context.record?.labourRate || "",
      materialsCost: context.record?.materialsCost || "",
      plantCost: context.record?.plantCost || "",
      markupPercent: context.record?.markupPercent || "",
    });
  }, [
    context.record?.labourRate,
    context.record?.materialsCost,
    context.record?.plantCost,
    context.record?.markupPercent,
  ]);

  return (
    <article className="daywork-account-form">
      <header className="daywork-account-masthead">
        <div>
          <p className="daywork-account-kicker">Errol Watson Group style sheet</p>
          <h3>Daywork Account</h3>
          <p>
            Field captures labour hours, materials used and dual sign-off. Office adds labour rate and materials /
            plant costs here before the sheet goes out with valuations.
          </p>
        </div>
        <div className="daywork-account-ref">
          <strong>{context.jobRef}</strong>
          <span>
            {filledCount}/{totalCount} fields ·{" "}
            {totals.labourHours ? `${totals.labourHours} hrs` : "No hours yet"}
            {totals.total
              ? ` · ${totals.total.toLocaleString("en-GB", { style: "currency", currency: "GBP" })}`
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
          <p>Add costs before including this daywork in an application for payment.</p>
          <div className="daywork-office-pricing-grid">
            <label>
              <span>Labour rate (£/hr)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={costs.labourRate}
                onChange={(event) => setCosts((current) => ({ ...current, labourRate: event.target.value }))}
              />
            </label>
            <label>
              <span>Materials cost (£)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={costs.materialsCost}
                onChange={(event) => setCosts((current) => ({ ...current, materialsCost: event.target.value }))}
              />
            </label>
            <label>
              <span>Plant cost (£)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={costs.plantCost}
                onChange={(event) => setCosts((current) => ({ ...current, plantCost: event.target.value }))}
              />
            </label>
            <label>
              <span>Add % on mats/plant</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={costs.markupPercent}
                onChange={(event) => setCosts((current) => ({ ...current, markupPercent: event.target.value }))}
              />
            </label>
          </div>
          <div className="daywork-office-pricing-actions">
            <strong>
              {totals.labourHours ? `${totals.labourHours} hrs from Field` : "No Field hours yet"}
              {costs.labourRate
                ? ` · labour ${(Number(costs.labourRate) * (totals.labourHours || 0) || 0).toLocaleString("en-GB", {
                    style: "currency",
                    currency: "GBP",
                  })}`
                : ""}
            </strong>
            <button
              className="simpro-blue-button"
              type="button"
              disabled={Boolean(savingOfficeCosts)}
              onClick={() => void onSaveOfficeCosts(costs)}
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
      </footer>
    </article>
  );
}

export type { DayworkAccountRecord };
