"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

type VariationPortalRecord = {
  variationEventId: string;
  variationRef: string;
  jobId: string;
  jobRef: string;
  summary: string;
  description: string;
  costValue: number;
  sellValue: number;
  status: "Pending" | "Viewed" | "Approved" | "Declined";
  createdAt: string;
  updatedAt: string;
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function money(value: number) {
  return gbp.format(Number.isFinite(value) ? value : 0);
}

function parseRecordStatus(status: VariationPortalRecord["status"]) {
  if (status === "Approved" || status === "Declined") return status;
  if (status === "Viewed") return "Viewed";
  return "Pending";
}

export default function ClientVariationPortal({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [record, setRecord] = useState<VariationPortalRecord | null>(null);
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
    async function loadVariation() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/variation-portal/${token}`, { cache: "no-store" });
        if (!response.ok) throw new Error("This variation approval link could not be found.");
        const loaded = (await response.json()) as VariationPortalRecord;
        if (!cancelled) {
          setRecord(loaded);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to load variation.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadVariation();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function respond(responseValue: "Approved" | "Declined") {
    if (!token || !record || isResponding) return;
    setIsResponding(true);
    setError("");
    try {
      const response = await fetch(`/api/variation-portal/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: responseValue }),
      });
      if (!response.ok) throw new Error("Unable to save your response. Please contact the office.");
      const updated = (await response.json()) as VariationPortalRecord;
      setRecord(updated);
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
          <span className="verrova-client-lockup">
            <span className="verrova-mark" aria-hidden="true">V</span>
            <strong>Verrova</strong>
          </span>
          <span>Online variation approval</span>
        </header>

        {isLoading ? (
          <div className="client-portal-state">
            <Loader2 className="spin" size={28} />
            <p>Loading your variation request...</p>
          </div>
        ) : error ? (
          <div className="client-portal-state error">
            <XCircle size={30} />
            <p>{error}</p>
          </div>
        ) : record ? (
          <>
            <div className="client-portal-heading">
              <span>{record.jobRef}</span>
              <h1>{record.summary}</h1>
              <p>Additional variation to approve</p>
            </div>

            <div className="client-portal-total">
              <span>Client charge</span>
              <strong>{money(record.sellValue)}</strong>
              <small>Additional charge includes labour and materials from your requested change.</small>
            </div>

            <div>
              <strong>Variation details</strong>
              <p>{record.description}</p>
            </div>

            {record.status === "Approved" ? (
              <div className="client-portal-confirmation">
                <CheckCircle2 size={24} />
                <div>
                  <strong>Variation approved</strong>
                  <span>Verrova has been notified and office can proceed.</span>
                </div>
              </div>
            ) : record.status === "Declined" ? (
              <div className="client-portal-confirmation declined">
                <XCircle size={24} />
                <div>
                  <strong>Variation declined</strong>
                  <span>The office has been notified.</span>
                </div>
              </div>
            ) : (
              <div className="client-portal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isResponding}
                  onClick={() => respond("Declined")}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={isResponding}
                  onClick={() => respond("Approved")}
                >
                  {isResponding ? "Saving..." : "Approve variation"}
                </button>
              </div>
            )}

            <p>{parseRecordStatus(record.status)}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
