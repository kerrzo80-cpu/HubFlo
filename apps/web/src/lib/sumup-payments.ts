import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { appendAuditEvent } from "@/lib/people-data";
import { getSumUpApiKey, getSumUpMerchantCode, isSumUpConfigured } from "@/lib/sumup-key-store";

const SUMUP_API = "https://api.sumup.com/v0.1";

export type OnlineLedgerPayment = {
  id: string;
  paidAt: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  actor?: string;
  source?: "manual" | "xero" | "sumup" | "stripe" | "adjustment";
  sourcePaymentId?: string;
  sourceInvoiceId?: string;
  importedAt?: string;
  reconciled?: boolean;
};

type HubInvoice = {
  id: string;
  ref: string;
  customer: string;
  chargeTotal: number;
  vatRate?: number;
  status?: string;
  paymentStatus?: string;
  paidAmount?: number;
  payments?: OnlineLedgerPayment[];
  portalToken?: string;
  notes?: string;
};

export type SumUpCheckout = {
  id: string;
  status?: string;
  amount?: number;
  currency?: string;
  checkout_reference?: string;
  hosted_checkout_url?: string;
  description?: string;
  transactions?: Array<{ id?: string; transaction_code?: string; amount?: number; status?: string }>;
};

function listInvoices(): HubInvoice[] {
  const raw = getHubDetailState().invoices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is HubInvoice => Boolean(item && typeof item === "object"));
}

function grandTotal(invoice: HubInvoice) {
  const charge = Number(invoice.chargeTotal) || 0;
  const vatRate = Number(invoice.vatRate) || 0;
  return Math.round((charge + charge * (vatRate / 100)) * 100) / 100;
}

function paymentStatusFor(paid: number, total: number): "Unpaid" | "Part paid" | "Paid" {
  if (paid <= 0) return "Unpaid";
  if (paid + 0.009 >= total) return "Paid";
  return "Part paid";
}

async function sumUpFetch(path: string, init?: RequestInit) {
  const apiKey = getSumUpApiKey();
  if (!apiKey) throw new Error("SumUp API key is not configured.");
  const response = await fetch(`${SUMUP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as SumUpCheckout & {
    message?: string;
    error_message?: string;
    error_code?: string;
  };
  if (!response.ok) {
    throw new Error(body.error_message || body.message || `SumUp request failed (${response.status}).`);
  }
  return body;
}

export function invoiceOwed(invoice: HubInvoice) {
  return Math.max(0, Math.round((grandTotal(invoice) - (Number(invoice.paidAmount) || 0)) * 100) / 100);
}

export function findInvoiceForSumUp(meta: {
  invoiceId?: string | null;
  invoiceRef?: string | null;
  portalToken?: string | null;
  checkoutReference?: string | null;
}) {
  const invoices = listInvoices();
  if (meta.invoiceId) {
    const byId = invoices.find((invoice) => invoice.id === meta.invoiceId);
    if (byId) return byId;
  }
  if (meta.portalToken) {
    const token = meta.portalToken.toLowerCase();
    const byToken = invoices.find((invoice) => String(invoice.portalToken || "").toLowerCase() === token);
    if (byToken) return byToken;
  }
  if (meta.checkoutReference) {
    // checkout_reference format: nexa-{invoiceId}-{stamp}
    const match = meta.checkoutReference.match(/^nexa-([^-]+(?:-[^-]+)*)-/);
    const maybeId = match?.[1];
    if (maybeId) {
      const byRefId = invoices.find((invoice) => invoice.id === maybeId || invoice.id.endsWith(maybeId));
      if (byRefId) return byRefId;
      // Prefer exact id embedded after nexa-
      const exact = invoices.find((invoice) => meta.checkoutReference!.includes(invoice.id));
      if (exact) return exact;
    }
  }
  if (meta.invoiceRef) {
    const ref = meta.invoiceRef.toLowerCase();
    return invoices.find((invoice) => invoice.ref.toLowerCase() === ref) ?? null;
  }
  return null;
}

export async function createSumUpHostedCheckout(input: {
  invoice: HubInvoice;
  portalToken: string;
  amount: number;
  origin: string;
}) {
  if (!isSumUpConfigured()) throw new Error("SumUp is not configured.");
  const merchantCode = getSumUpMerchantCode();
  const amount = Math.round(input.amount * 100) / 100;
  if (amount < 1) throw new Error("Amount is too small for SumUp checkout.");

  const checkoutReference = `nexa-${input.invoice.id}-${Date.now().toString(36)}`;
  const body = await sumUpFetch("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      amount,
      currency: "GBP",
      checkout_reference: checkoutReference,
      merchant_code: merchantCode,
      description: `${input.invoice.ref} — ${input.invoice.customer}`,
      redirect_url: `${input.origin}/client/invoices/${input.portalToken}?paid=1`,
      return_url: `${input.origin}/api/integrations/sumup/webhook`,
      hosted_checkout: { enabled: true },
    }),
  });

  if (!body.id || !body.hosted_checkout_url) {
    throw new Error("SumUp did not return a hosted checkout URL.");
  }

  return {
    checkoutId: body.id,
    checkoutReference,
    url: body.hosted_checkout_url,
  };
}

export async function fetchSumUpCheckout(checkoutId: string) {
  return sumUpFetch(`/checkouts/${encodeURIComponent(checkoutId)}`);
}

/** Apply a PAID SumUp checkout onto the invoice ledger (idempotent). */
export function applySumUpPaymentToInvoice(input: {
  invoiceId: string;
  amount: number;
  paidAt?: string;
  checkoutId: string;
  transactionCode?: string;
}) {
  const hub = getHubDetailState();
  const invoices = listInvoices();
  const invoice = invoices.find((row) => row.id === input.invoiceId);
  if (!invoice) return { ok: false as const, reason: "not_found" as const };

  const sourcePaymentId = input.transactionCode || input.checkoutId;
  const existing = Array.isArray(invoice.payments) ? invoice.payments : [];
  if (
    sourcePaymentId &&
    existing.some(
      (payment) =>
        payment.sourcePaymentId === `sumup:${sourcePaymentId}` ||
        payment.id === `sumup:${sourcePaymentId}` ||
        payment.sourcePaymentId === `sumup:${input.checkoutId}`,
    )
  ) {
    return { ok: true as const, invoice, duplicate: true as const };
  }

  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (amount <= 0) return { ok: false as const, reason: "invalid_amount" as const };

  const payment: OnlineLedgerPayment = {
    id: `sumup-${sourcePaymentId}`,
    paidAt: (input.paidAt || new Date().toISOString()).slice(0, 10),
    amount,
    method: "SumUp",
    reference: input.transactionCode || input.checkoutId,
    note: "Paid online via SumUp Hosted Checkout",
    actor: invoice.customer,
    source: "sumup",
    sourcePaymentId: `sumup:${sourcePaymentId}`,
    importedAt: new Date().toISOString(),
    reconciled: true,
  };

  const payments = [...existing, payment];
  const paidAmount = Math.round(payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100;
  const total = grandTotal(invoice);
  const paymentStatus = paymentStatusFor(paidAmount, total);
  const status = paymentStatus === "Paid" ? "Paid" : paymentStatus === "Part paid" ? "Partially paid" : invoice.status;

  const nextInvoice = {
    ...invoice,
    payments,
    paidAmount,
    paymentStatus,
    status,
  };

  saveHubDetailState({
    ...hub,
    invoices: invoices.map((row) => (row.id === invoice.id ? nextInvoice : row)),
  });

  appendAuditEvent({
    actor: invoice.customer,
    action: "payment",
    recordType: "invoice",
    recordId: invoice.id,
    summary: `${invoice.ref}: £${amount.toFixed(2)} paid online via SumUp.`,
    source: "client portal",
    importance: "high",
  });

  return { ok: true as const, invoice: nextInvoice, duplicate: false as const };
}

/** Fetch checkout from SumUp; if PAID, apply to matching invoice. */
export async function syncSumUpCheckoutToLedger(checkoutId: string, hintInvoiceId?: string) {
  const checkout = await fetchSumUpCheckout(checkoutId);
  const status = String(checkout.status || "").toUpperCase();
  if (status !== "PAID") {
    return { ok: false as const, reason: "not_paid" as const, status, checkout };
  }

  const invoice =
    (hintInvoiceId ? listInvoices().find((row) => row.id === hintInvoiceId) : null) ||
    findInvoiceForSumUp({
      checkoutReference: checkout.checkout_reference,
    });

  if (!invoice) {
    return { ok: false as const, reason: "invoice_not_found" as const, status, checkout };
  }

  const tx = (checkout.transactions || []).find((row) => String(row.status || "").toUpperCase() === "SUCCESSFUL") ||
    checkout.transactions?.[0];
  const amount = Number(tx?.amount) || Number(checkout.amount) || invoiceOwed(invoice);

  const applied = applySumUpPaymentToInvoice({
    invoiceId: invoice.id,
    amount,
    checkoutId: checkout.id,
    transactionCode: tx?.transaction_code || tx?.id,
  });

  return { ...applied, status, checkout };
}
