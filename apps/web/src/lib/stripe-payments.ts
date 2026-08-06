import Stripe from "stripe";

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { appendAuditEvent } from "@/lib/people-data";
import { getStripeSecretKey } from "@/lib/stripe-key-store";

export type StripeLedgerPayment = {
  id: string;
  paidAt: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  actor?: string;
  source?: "manual" | "xero" | "stripe" | "adjustment";
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
  payments?: StripeLedgerPayment[];
  portalToken?: string;
  notes?: string;
};

export function getStripeClient() {
  const key = getStripeSecretKey();
  if (!key) return null;
  return new Stripe(key);
}

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

export function findInvoiceForStripe(metadata: { invoiceId?: string | null; invoiceRef?: string | null; portalToken?: string | null }) {
  const invoices = listInvoices();
  if (metadata.invoiceId) {
    const byId = invoices.find((invoice) => invoice.id === metadata.invoiceId);
    if (byId) return byId;
  }
  if (metadata.portalToken) {
    const token = metadata.portalToken.toLowerCase();
    const byToken = invoices.find((invoice) => String(invoice.portalToken || "").toLowerCase() === token);
    if (byToken) return byToken;
  }
  if (metadata.invoiceRef) {
    const ref = metadata.invoiceRef.toLowerCase();
    return invoices.find((invoice) => invoice.ref.toLowerCase() === ref) ?? null;
  }
  return null;
}

/** Apply a successful Stripe Checkout / PaymentIntent onto the invoice ledger. */
export function applyStripePaymentToInvoice(input: {
  invoiceId: string;
  amount: number;
  paidAt?: string;
  paymentIntentId?: string;
  sessionId?: string;
  customerEmail?: string;
}) {
  const hub = getHubDetailState();
  const invoices = listInvoices();
  const invoice = invoices.find((row) => row.id === input.invoiceId);
  if (!invoice) return { ok: false as const, reason: "not_found" as const };

  const sourcePaymentId = input.paymentIntentId || input.sessionId;
  const existing = Array.isArray(invoice.payments) ? invoice.payments : [];
  if (sourcePaymentId && existing.some((payment) => payment.sourcePaymentId === `stripe:${sourcePaymentId}` || payment.id === `stripe:${sourcePaymentId}`)) {
    return { ok: true as const, invoice, duplicate: true as const };
  }

  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (amount <= 0) return { ok: false as const, reason: "invalid_amount" as const };

  const payment: StripeLedgerPayment = {
    id: `stripe-${sourcePaymentId || Date.now()}`,
    paidAt: (input.paidAt || new Date().toISOString()).slice(0, 10),
    amount,
    method: "Stripe",
    reference: sourcePaymentId || undefined,
    note: input.customerEmail ? `Paid online by ${input.customerEmail}` : "Paid online via Stripe Checkout",
    actor: invoice.customer,
    source: "stripe",
    sourcePaymentId: sourcePaymentId ? `stripe:${sourcePaymentId}` : undefined,
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

  const nextInvoices = invoices.map((row) => (row.id === invoice.id ? nextInvoice : row));
  saveHubDetailState({ ...hub, invoices: nextInvoices });

  appendAuditEvent({
    actor: invoice.customer,
    action: "payment",
    recordType: "invoice",
    recordId: invoice.id,
    summary: `${invoice.ref}: £${amount.toFixed(2)} paid online via Stripe.`,
    source: "client portal",
    importance: "high",
  });

  return { ok: true as const, invoice: nextInvoice, duplicate: false as const };
}

export function invoiceOwed(invoice: HubInvoice) {
  return Math.max(0, Math.round((grandTotal(invoice) - (Number(invoice.paidAmount) || 0)) * 100) / 100);
}
