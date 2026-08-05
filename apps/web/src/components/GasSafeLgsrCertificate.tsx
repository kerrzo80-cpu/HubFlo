import { gasSafeCertificateSections, type GasSafeCertificateContext } from "@/lib/gas-safe-lgsr-form";
import type { FormDocumentChrome } from "@/lib/form-document-chrome";

export function GasSafeLgsrCertificate({
  context,
  chrome,
}: {
  context: GasSafeCertificateContext;
  chrome?: FormDocumentChrome | null;
}) {
  const sections = gasSafeCertificateSections(context);
  const filledCount = sections.reduce(
    (sum, section) => sum + section.rows.filter((row) => row.filled).length,
    0,
  );
  const totalCount = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const title = chrome?.title || "Landlord’s Gas Safety Record";
  const kicker = chrome?.headerNote || chrome?.tradingName || "Gas Safe Register style record";
  const intro =
    chrome?.intro ||
    "CP12 / LGSR layout — completed from Field stop/go on Boiler servicing.";

  return (
    <article className="gas-safe-lgsr-cert" style={chrome?.headerColor ? { ["--gas-safe-accent" as string]: chrome.headerColor } : undefined}>
      <header className="gas-safe-lgsr-masthead">
        <div className="gas-safe-lgsr-brand">
          {chrome?.showLogo !== false && chrome?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={chrome.logoUrl} alt={chrome.tradingName || "Company logo"} />
          ) : null}
          <div>
            <p className="gas-safe-lgsr-kicker">{kicker}</p>
            <h3>{title}</h3>
            <p>{intro}</p>
            {chrome?.showCompanyDetails ? (
              <small>
                {chrome.tradingName}
                {chrome.address ? ` · ${chrome.address}` : ""}
                {chrome.showVatCompanyNumbers && chrome.vatNumber ? ` · VAT ${chrome.vatNumber}` : ""}
              </small>
            ) : null}
          </div>
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
        <p>{chrome?.footer || chrome?.terms || "Office review copy of the Gas Safe / LGSR record completed from Field."}</p>
        {chrome?.tradingName ? <small>{chrome.tradingName}{chrome.brandLine ? ` · ${chrome.brandLine}` : ""}</small> : null}
      </footer>
    </article>
  );
}
