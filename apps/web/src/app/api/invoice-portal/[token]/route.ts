import { NextResponse } from "next/server";

import { appendAuditEvent } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { isSumUpConfigured } from "@/lib/sumup-key-store";

type RouteContext = {
  params: Promise<{ token: string }>;
};

type PortalInvoice = {
  id: string;
  ref: string;
  customer: string;
  title: string;
  status: string;
  issuedDate?: string;
  dueDate?: string;
  chargeTotal: number;
  vatRate?: number;
  paymentStatus?: string;
  paidAmount?: number;
  portalToken?: string;
  portalViewedAt?: string;
  notes?: string;
  chaseCount?: number;
};

function listInvoices(): PortalInvoice[] {
  const raw = getHubDetailState().invoices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is PortalInvoice => Boolean(item && typeof item === "object"));
}

function findInvoiceByToken(token: string) {
  const cleaned = token.trim().toLowerCase();
  return (
    listInvoices().find((invoice) => {
      const portal = String(invoice.portalToken || "").toLowerCase();
      const ref = String(invoice.ref || "").toLowerCase();
      return portal === cleaned || ref === cleaned;
    }) ?? null
  );
}

function owedAmount(invoice: PortalInvoice) {
  const charge = Number(invoice.chargeTotal) || 0;
  const vatRate = Number(invoice.vatRate) || 0;
  const grand = charge + charge * (vatRate / 100);
  const paid = Number(invoice.paidAmount) || 0;
  return Math.max(0, Math.round((grand - paid) * 100) / 100);
}

function publicInvoice(invoice: PortalInvoice) {
  const charge = Number(invoice.chargeTotal) || 0;
  const vatRate = Number(invoice.vatRate) || 0;
  const vat = Math.round(charge * (vatRate / 100) * 100) / 100;
  const grandTotal = Math.round((charge + vat) * 100) / 100;
  const paidAmount = Number(invoice.paidAmount) || 0;
  return {
    id: invoice.id,
    ref: invoice.ref,
    customer: invoice.customer,
    title: invoice.title,
    status: invoice.status,
    issuedDate: invoice.issuedDate,
    dueDate: invoice.dueDate,
    chargeTotal: charge,
    vat,
    grandTotal,
    paymentStatus: invoice.paymentStatus || (paidAmount >= grandTotal && grandTotal > 0 ? "Paid" : paidAmount > 0 ? "Part paid" : "Unpaid"),
    paidAmount,
    owed: owedAmount(invoice),
    viewedAt: invoice.portalViewedAt,
  };
}

function patchInvoice(id: string, patch: Partial<PortalInvoice>) {
  const hub = getHubDetailState();
  const invoices = listInvoices();
  const next = invoices.map((invoice) => (invoice.id === id ? { ...invoice, ...patch } : invoice));
  saveHubDetailState({ ...hub, invoices: next });
  return next.find((invoice) => invoice.id === id) ?? null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const invoice = findInvoiceByToken(token);
  if (!invoice) {
    return NextResponse.json({ error: "Invoice link not found" }, { status: 404 });
  }

  if (!invoice.portalViewedAt) {
    patchInvoice(invoice.id, { portalViewedAt: new Date().toISOString() });
    appendAuditEvent({
      actor: invoice.customer,
      action: "viewed",
      recordType: "invoice",
      recordId: invoice.id,
      summary: `${invoice.ref} was opened through the online invoice portal.`,
      source: "client portal",
      importance: "normal",
    });
  }

  const fresh = findInvoiceByToken(token) ?? invoice;
  return NextResponse.json({
    ...publicInvoice(fresh),
    sumupEnabled: isSumUpConfigured(),
  });
}

/** Client can acknowledge payment intent (bank transfer) — office still confirms ledger. */
export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const invoice = findInvoiceByToken(token);
  if (!invoice) {
    return NextResponse.json({ error: "Invoice link not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as
    | { action?: "payment-intent"; note?: string }
    | null;
  if (payload?.action !== "payment-intent") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const note = String(payload.note || "Customer marked payment sent via portal.").trim();
  const stamp = new Date().toISOString();
  const updated = patchInvoice(invoice.id, {
    notes: [invoice.notes, `[Portal ${stamp.slice(0, 10)}] ${note}`].filter(Boolean).join("\n"),
    chaseCount: Number(invoice.chaseCount || 0),
  });

  appendAuditEvent({
    actor: invoice.customer,
    action: "payment-intent",
    recordType: "invoice",
    recordId: invoice.id,
    summary: `${invoice.ref}: customer reported payment sent online.`,
    source: "client portal",
    importance: "high",
  });

  return NextResponse.json({
    invoice: publicInvoice(updated ?? invoice),
    message: "Thanks — the office has been notified that payment is on the way.",
  });
}
