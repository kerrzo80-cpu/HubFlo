"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

type PortalQuote = {
  id: string;
  ref: string;
  customer: string;
  description: string;
  status: string;
  value: number;
  viewedAt?: string;
  respondedAt?: string;
};

type PortalResponse = {
  quote: PortalQuote;
  job?: {
    ref: string;
    status: string;
  } | null;
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function money(value: number) {
  return gbp.format(Number.isFinite(value) ? value : 0);
}

export default function ClientQuotePortal({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [quote, setQuote] = useState<PortalQuote | null>(null);
  const [jobRef, setJobRef] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isResponding, setIsResponding] = useState(false);
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
    async function loadQuote() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/quote-portal/${token}`, { cache: "no-store" });
        if (!response.ok) throw new Error("This quote link could not be found.");
        const loaded = (await response.json()) as PortalQuote;
        if (!cancelled) setQuote(loaded);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load quote.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadQuote();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function respond(responseValue: "Accepted" | "Declined") {
    if (!token || isResponding) return;
    setIsResponding(true);
    setError("");
    try {
      const response = await fetch(`/api/quote-portal/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: responseValue }),
      });
      if (!response.ok) throw new Error("Unable to save your response. Please contact the office.");
      const result = (await response.json()) as PortalResponse;
      setQuote(result.quote);
      setJobRef(result.job?.ref ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save response.");
    } finally {
      setIsResponding(false);
    }
  }

  return (
    <main className="client-portal-shell">
      <section className="client-portal-card">
        <header>
          <Image src="/ewg-logo.png" alt="Errol Watson Group" width={120} height={68} priority />
          <span>Online quote review</span>
        </header>

        {isLoading ? (
          <div className="client-portal-state">
            <Loader2 className="spin" size={28} />
            <p>Loading your quote...</p>
          </div>
        ) : error ? (
          <div className="client-portal-state error">
            <XCircle size={30} />
            <p>{error}</p>
          </div>
        ) : quote ? (
          <>
            <div className="client-portal-heading">
              <span>{quote.ref}</span>
              <h1>{quote.description}</h1>
              <p>{quote.customer}</p>
            </div>

            <div className="client-portal-total">
              <span>Quote value</span>
              <strong>{money(quote.value)}</strong>
              <small>Figures shown are excluding VAT unless your issued quote states otherwise.</small>
            </div>

            {quote.status === "Accepted" || quote.status === "Converted" ? (
              <div className="client-portal-confirmation">
                <CheckCircle2 size={24} />
                <div>
                  <strong>Quote accepted</strong>
                  <span>{jobRef ? `HubFlo has created pending job ${jobRef}.` : "The office has been notified."}</span>
                </div>
              </div>
            ) : quote.status === "Declined" ? (
              <div className="client-portal-confirmation declined">
                <XCircle size={24} />
                <div>
                  <strong>Quote declined</strong>
                  <span>The office has been notified.</span>
                </div>
              </div>
            ) : (
              <div className="client-portal-actions">
                <button type="button" className="secondary-button" disabled={isResponding} onClick={() => respond("Declined")}>
                  Decline
                </button>
                <button type="button" className="primary-button" disabled={isResponding} onClick={() => respond("Accepted")}>
                  {isResponding ? "Saving..." : "Accept quote"}
                </button>
              </div>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
