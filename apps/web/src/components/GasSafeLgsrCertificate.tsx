import { gasSafeCertificateSections, type GasSafeCertificateContext } from "@/lib/gas-safe-lgsr-form";

export function GasSafeLgsrCertificate({ context }: { context: GasSafeCertificateContext }) {
  const sections = gasSafeCertificateSections(context);
  const filledCount = sections.reduce(
    (sum, section) => sum + section.rows.filter((row) => row.filled).length,
    0,
  );
  const totalCount = sections.reduce((sum, section) => sum + section.rows.length, 0);

  return (
    <article className="gas-safe-lgsr-cert">
      <header className="gas-safe-lgsr-masthead">
        <div>
          <p className="gas-safe-lgsr-kicker">Gas Safe Register style record</p>
          <h3>Landlord’s Gas Safety Record</h3>
          <p>
            CP12 / LGSR layout for NeXa — same cost-centre gas cert pattern used in simPRO. Completed from Field
            stop/go on Boiler servicing.
          </p>
        </div>
        <div className="gas-safe-lgsr-ref">
          <strong>{context.jobRef}</strong>
          <span>
            {filledCount}/{totalCount} fields complete
          </span>
        </div>
      </header>

      {sections.map((section) => (
        <section className="gas-safe-lgsr-section" key={section.section}>
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

      <footer className="gas-safe-lgsr-footer">
        <p>
          This is NeXa’s live Gas Safe / LGSR form view for office review. Engineer Gas Safe ID and statutory PDF
          pack can still be hardened; values already flow from the Field checklist into this record.
        </p>
      </footer>
    </article>
  );
}
