"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, XCircle } from "lucide-react";
import { useBrand } from "@/components/BrandProvider";
import { resolveBrandLogoUrl } from "@/lib/branding";

type HubLinkRecord = {
  id: string;
  ref: string;
  status: string;
  url: string;
};

type ClientHubPayload = {
  token: string;
  customerName: string;
  quotes: Array<HubLinkRecord & {
    description: string;
    value: number;
    due: string;
    next: string;
  }>;
  invoices: Array<HubLinkRecord & {
    title: string;
    dueDate?: string;
    grandTotal: number;
    owed: number;
    paymentStatus: string;
  }>;
  variations: Array<HubLinkRecord & {
    variationRef: string;
    jobRef: string;
    summary: string;
    description: string;
    sellValue: number;
  }>;
  jobs: Array<{
    id: string;
    ref: string;
    description: string;
    site: string;
    status: string;
    next: string;
    due: string;
  }>;
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function money(value: number) {
  return gbp.format(Number.isFinite(value) ? value : 0);
}

function portalUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

export default function ClientHubPortal({ params }: { params: Promise<{ token: string }> }) {
  const brand = useBrand();
  const [token, setToken] = useState("");
  const [hub, setHub] = useState<ClientHubPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    params.then(({ token: nextToken }) => {
      if (!cancelled) setToken(nextToken);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    async function loadHub() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/client-portal/hub/${token}`, { cache: "no-store" });
        if (!response.ok) throw new Error("This customer hub link could not be found.");
        const loaded = (await response.json()) as ClientHubPayload;
        if (!cancelled) setHub(loaded);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load customer hub.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadHub();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const totalActionCount = useMemo(() => {
    if (!hub) return 0;
    return hub.quotes.length + hub.invoices.length + hub.variations.length;
  }, [hub]);

  return (
    <main className="client-portal-shell">
      <section className="client-portal-card client-hub-card">
        <header>
          <span className="verrova-client-lockup">
            <img src={resolveBrandLogoUrl(brand)} alt="" aria-hidden="true" />
            <strong>{brand.companyName}</strong>
          </span>
          <span>Customer hub</span>
        </header>

        {isLoading ? (
          <div className="client-portal-state">
            <Loader2 className="spin" size={28} />
            <p>Loading your customer hub...</p>
          </div>
        ) : error ? (
          <div className="client-portal-state error">
            <XCircle size={30} />
            <p>{error}</p>
          </div>
        ) : hub ? (
          <>
            <div className="client-portal-heading">
              <span>{totalActionCount ? `${totalActionCount} item${totalActionCount === 1 ? "" : "s"} needing attention` : "Nothing waiting"}</span>
              <h1>{hub.customerName}</h1>
              <p>Your quotes, invoices, variations and job updates in one place.</p>
            </div>

            <section className="client-hub-section">
              <div className="client-hub-section-heading">
                <span>Open quotes</span>
                <strong>{hub.quotes.length}</strong>
              </div>
              {hub.quotes.length ? (
                <div className="client-hub-list">
                  {hub.quotes.map((quote) => (
                    <a className="client-hub-row" href={portalUrl(quote.url)} key={quote.id}>
                      <span>
                        <strong>{quote.ref}</strong>
                        <small>{quote.description}</small>
                      </span>
                      <span>
                        <strong>{money(quote.value)}</strong>
                        <small>{quote.status} · {quote.due || quote.next}</small>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="client-hub-empty">No open quotes are waiting for you.</p>
              )}
            </section>

            <section className="client-hub-section">
              <div className="client-hub-section-heading">
                <span>Open invoices</span>
                <strong>{hub.invoices.length}</strong>
              </div>
              {hub.invoices.length ? (
                <div className="client-hub-list">
                  {hub.invoices.map((invoice) => (
                    <a className="client-hub-row" href={portalUrl(invoice.url)} key={invoice.id}>
                      <span>
                        <strong>{invoice.ref}</strong>
                        <small>{invoice.title}</small>
                      </span>
                      <span>
                        <strong>{money(invoice.owed)}</strong>
                        <small>{invoice.paymentStatus}{invoice.dueDate ? ` · Due ${invoice.dueDate}` : ""}</small>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="client-hub-empty">No unpaid invoices are showing.</p>
              )}
            </section>

            <section className="client-hub-section">
              <div className="client-hub-section-heading">
                <span>Pending variations</span>
                <strong>{hub.variations.length}</strong>
              </div>
              {hub.variations.length ? (
                <div className="client-hub-list">
                  {hub.variations.map((variation) => (
                    <a className="client-hub-row" href={portalUrl(variation.url)} key={variation.id}>
                      <span>
                        <strong>{variation.variationRef} · {variation.jobRef}</strong>
                        <small>{variation.summary}</small>
                      </span>
                      <span>
                        <strong>{money(variation.sellValue)}</strong>
                        <small>{variation.status}</small>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="client-hub-empty">No variations are pending approval.</p>
              )}
            </section>

            <section className="client-hub-section">
              <div className="client-hub-section-heading">
                <span>Active jobs</span>
                <strong>{hub.jobs.length}</strong>
              </div>
              {hub.jobs.length ? (
                <div className="client-hub-list">
                  {hub.jobs.map((job) => (
                    <div className="client-hub-row static" key={job.id}>
                      <span>
                        <strong>{job.ref}</strong>
                        <small>{job.description}{job.site ? ` · ${job.site}` : ""}</small>
                      </span>
                      <span>
                        <strong>{job.status}</strong>
                        <small>{job.next || job.due || "We will update you shortly."}</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="client-hub-empty">No active jobs are currently showing.</p>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
