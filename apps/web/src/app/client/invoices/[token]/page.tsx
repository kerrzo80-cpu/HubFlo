"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, XCircle } from "lucide-react";
import { useBrand } from "@/components/BrandProvider";
import { resolveBrandLogoUrl } from "@/lib/branding";

type PortalInvoice = {
  id: string;
  ref: string;
  customer: string;
  title: string;
  status: string;
  issuedDate?: string;
  dueDate?: string;
  chargeTotal: number;
  vat: number;
  grandTotal: number;
  paymentStatus: string;
  paidAmount: number;
  owed: number;
  viewedAt?: string;
  sumupEnabled?: boolean;
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function money(value: number) {
  return gbp.format(Number.isFinite(value) ? value : 0);
}

export default function ClientInvoicePortal({ params }: { params: Promise<{ token: string }> }) {
  const brand = useBrand();
  const [token, setToken] = useState("");
  const [invoice, setInvoice] = useState<PortalInvoice | null>(null);
  const [sumupEnabled, setSumupEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [message, setMessage] = useState("");
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
    if (!token || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") {
      setError("Card payment was cancelled. You can try again or pay by bank transfer.");
      return;
    }
    if (params.get("paid") !== "1") return;

    let cancelled = false;
    async function confirmPaid() {
      setMessage("Confirming SumUp payment…");
      try {
        const checkoutId = params.get("checkout") || undefined;
        const checkoutRef = params.get("checkoutRef") || undefined;
        const response = await fetch(`/api/invoice-portal/${token}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkoutId, checkoutRef }),
        });
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          message?: string;
          error?: string;
          result?: { invoice?: PortalInvoice; ok?: boolean };
        } | null;
        if (!cancelled) {
          if (body?.result && "invoice" in body.result && body.result.invoice) {
            setInvoice((current) => ({ ...(current || ({} as PortalInvoice)), ...body.result!.invoice! }));
          }
          setMessage(
            body?.ok
              ? "Payment received — thank you."
              : body?.message || body?.error || "If you paid, the office ledger will update shortly.",
          );
        }
      } catch {
        if (!cancelled) setMessage("If you paid on SumUp, the office ledger will update shortly.");
      }
    }
    void confirmPaid();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function loadInvoice() {
      setIsLoading(true);
      const cancelledNotice =
        typeof window !== "undefined" && new URLSearchParams(window.location.search).get("cancelled") === "1"
          ? "Card payment was cancelled. You can try again or pay by bank transfer."
          : "";
      if (!cancelled) setError(cancelledNotice);
      try {
        const invoiceRes = await fetch(`/api/invoice-portal/${token}`, { cache: "no-store" });
        if (!invoiceRes.ok) throw new Error("This invoice link could not be found.");
        const loaded = (await invoiceRes.json()) as PortalInvoice;
        if (!cancelled) {
          setInvoice(loaded);
          setSumupEnabled(Boolean(loaded.sumupEnabled));
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load invoice.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadInvoice();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function reportPaymentSent() {
    if (!token || isSaving) return;
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/invoice-portal/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "payment-intent",
          note: "Customer marked bank payment as sent.",
        }),
      });
      if (!response.ok) throw new Error("Unable to notify the office. Please call us.");
      const result = (await response.json()) as { invoice: PortalInvoice; message?: string };
      setInvoice(result.invoice);
      setMessage(result.message || "The office has been notified.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save.");
    } finally {
      setIsSaving(false);
    }
  }

  async function payOnline() {
    if (!token || isPaying) return;
    setIsPaying(true);
    setError("");
    try {
      const response = await fetch(`/api/invoice-portal/${token}/checkout`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !body?.url) throw new Error(body?.error || "Unable to start card payment.");
      window.location.href = body.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start card payment.");
      setIsPaying(false);
    }
  }

  const paid = invoice && (invoice.paymentStatus === "Paid" || invoice.owed <= 0);

  return (
    <main className="client-portal-shell">
      <section className="client-portal-card">
        <header>
          <span className="verrova-client-lockup">
            <img src={resolveBrandLogoUrl(brand)} alt="" aria-hidden="true" />
            <strong>{brand.companyName}</strong>
          </span>
          <span>Online invoice</span>
        </header>

        {isLoading ? (
          <div className="client-portal-state">
            <Loader2 className="spin" size={28} />
            <p>Loading your invoice...</p>
          </div>
        ) : error && !invoice ? (
          <div className="client-portal-state error">
            <XCircle size={30} />
            <p>{error}</p>
          </div>
        ) : invoice ? (
          <>
            <div className="client-portal-heading">
              <span>{invoice.ref}</span>
              <h1>{invoice.title || "Invoice"}</h1>
              <p>{invoice.customer}</p>
            </div>

            <div className="client-portal-total">
              <span>Amount due</span>
              <strong>{money(invoice.owed)}</strong>
              <small>
                Total {money(invoice.grandTotal)}
                {invoice.paidAmount > 0 ? ` · Paid ${money(invoice.paidAmount)}` : ""}
                {invoice.dueDate ? ` · Due ${invoice.dueDate}` : ""}
              </small>
            </div>

            <div className="portal-status-grid" style={{ marginBottom: 16 }}>
              <div>
                <span>Status</span>
                <strong>{invoice.status}</strong>
              </div>
              <div>
                <span>Payment</span>
                <strong>{invoice.paymentStatus}</strong>
              </div>
              <div>
                <span>Issued</span>
                <strong>{invoice.issuedDate || "—"}</strong>
              </div>
            </div>

            {paid ? (
              <div className="client-portal-confirmation">
                <CheckCircle2 size={24} />
                <div>
                  <strong>Paid</strong>
                  <span>Thank you — this invoice is marked paid.</span>
                </div>
              </div>
            ) : (
              <div className="client-portal-actions">
                {sumupEnabled ? (
                  <button type="button" className="primary-button" disabled={isPaying} onClick={() => void payOnline()}>
                    <CreditCard size={16} />
                    {isPaying ? "Opening SumUp…" : "Pay online"}
                  </button>
                ) : null}
                <button type="button" className="secondary-button" disabled={isSaving} onClick={() => void reportPaymentSent()}>
                  {isSaving ? "Saving..." : "I've paid by bank transfer"}
                </button>
              </div>
            )}

            {message ? (
              <div className="client-portal-confirmation" style={{ marginTop: 16 }}>
                <CheckCircle2 size={22} />
                <div>
                  <strong>Noted</strong>
                  <span>{message}</span>
                </div>
              </div>
            ) : null}
            {error ? <p style={{ color: "#b42318", marginTop: 12 }}>{error}</p> : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
