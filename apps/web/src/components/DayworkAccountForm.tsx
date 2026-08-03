import { buildDayworkFormSections, dayworkAccountTotals, type DayworkAccountContext } from "@/lib/daywork-account-form";

export function DayworkAccountForm({ context }: { context: DayworkAccountContext }) {
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

  return (
    <article className="daywork-account-form">
      <header className="daywork-account-masthead">
        <div>
          <p className="daywork-account-kicker">Errol Watson Group style sheet</p>
          <h3>Daywork Account</h3>
          <p>
            Reactive variation daywork — labour, materials and plant from Field stop/go. Dual sign-off required
            before the sheet sits in Core Variations.
          </p>
        </div>
        <div className="daywork-account-ref">
          <strong>{context.jobRef}</strong>
          <span>
            {filledCount}/{totalCount} fields ·{" "}
            {totals.total
              ? totals.total.toLocaleString("en-GB", { style: "currency", currency: "GBP" })
              : "No total yet"}
          </span>
          <span className={bothSigned ? "daywork-sign-status ready" : "daywork-sign-status pending"}>
            {bothSigned ? "Plumber + client signed" : "Awaiting dual sign-off"}
          </span>
        </div>
      </header>

      {sections.map((section) => (
        <section className="daywork-account-section" key={section.section}>
          <h4>{section.section}</h4>
          <table>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.key} className={row.filled ? "filled" : "empty"}>
                  <th>{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <footer className="daywork-account-footer">
        <p>
          Values flow from the Field Daywork checklist into this sheet and into job Variations once both the
          plumber and client have signed.
        </p>
      </footer>
    </article>
  );
}
