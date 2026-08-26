import { appendAuditEvent } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { getXeroAuthStatus } from "@/lib/xero-auth";
import {
  pullXeroPaymentsForInvoice,
  type XeroPullInvoiceInput,
  validateInvoiceForXeroPaymentPull,
} from "@/lib/xero-payment-pull";

export type XeroPaymentSyncInvoiceResult = {
  invoiceId: string;
  invoiceRef: string;
  ok: boolean;
  addedCount?: number;
  skippedCount?: number;
  conflictCount?: number;
  paymentStatus?: string;
  status?: string;
  error?: string;
};

export type XeroPaymentSyncRun = {
  id: string;
  actor: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  scanned: number;
  attempted: number;
  updated: number;
  paymentsAdded: number;
  skipped: number;
  failed: number;
  results: XeroPaymentSyncInvoiceResult[];
  error?: string;
};

type XeroPaymentSyncStore = {
  runs: XeroPaymentSyncRun[];
  lastSuccessfulAt?: string;
};

const STORE_NAME = "nexa-xero-payment-sync-v1";
const MAX_RUNS = 20;
const DEFAULT_MAX_INVOICES = 100;

const syncStore = loadServerStore<XeroPaymentSyncStore>(STORE_NAME, { runs: [] });

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asHubInvoice(value: unknown): XeroPullInvoiceInput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const ref = typeof row.ref === "string" ? row.ref : "";
  if (!id || !ref) return null;
  return {
    id,
    ref,
    chargeTotal: Number(row.chargeTotal) || 0,
    vatRate: Number(row.vatRate) || 0,
    status: typeof row.status === "string" ? row.status : undefined,
    claimType: typeof row.claimType === "string" ? row.claimType : undefined,
    payments: Array.isArray(row.payments) ? (row.payments as XeroPullInvoiceInput["payments"]) : [],
    paidAmount: Number(row.paidAmount) || 0,
    paymentStatus: typeof row.paymentStatus === "string" ? row.paymentStatus : undefined,
    xeroInvoiceId: typeof row.xeroInvoiceId === "string" ? row.xeroInvoiceId : undefined,
  };
}

export function invoiceEligibleForXeroPaymentSync(row: Record<string, unknown>) {
  const status = String(row.status || "");
  const claimType = String(row.claimType || "");
  if (status === "Draft" || status === "Cancelled") return false;
  if (claimType === "valuation") return false;
  const exported =
    Boolean(String(row.xeroInvoiceId || "").trim()) ||
    Boolean(String(row.xeroExportedAt || "").trim()) ||
    /sent|export|xero/i.test(String(row.accountsStatus || ""));
  return exported;
}

function prioritizeInvoices(invoices: XeroPullInvoiceInput[]) {
  return [...invoices].sort((left, right) => {
    const leftPaid = left.paymentStatus === "Paid" || left.status === "Paid" ? 1 : 0;
    const rightPaid = right.paymentStatus === "Paid" || right.status === "Paid" ? 1 : 0;
    if (leftPaid !== rightPaid) return leftPaid - rightPaid;
    return left.ref.localeCompare(right.ref);
  });
}

export function getXeroPaymentSyncStatus() {
  const auth = getXeroAuthStatus();
  const lastRun = syncStore.runs[0] ? clone(syncStore.runs[0]) : undefined;
  return {
    configured: auth.configured,
    secretConfigured: Boolean(process.env.NEXA_IMPORT_TICK_SECRET?.trim()),
    lastRun,
    lastSuccessfulAt: syncStore.lastSuccessfulAt,
    scheduleHint: "Render cron nightly 22:30 UTC → POST /api/integrations/xero/payments/cron",
  };
}

export async function runXeroPaymentSync(input?: { actor?: string; maxInvoices?: number }) {
  const actor = input?.actor?.trim() || "Xero payment sync";
  const maxInvoices = Math.max(1, Math.min(input?.maxInvoices ?? DEFAULT_MAX_INVOICES, 200));
  const startedAt = new Date().toISOString();

  const auth = getXeroAuthStatus();
  if (!auth.configured) {
    throw new Error("Xero is not connected. Connect Xero in Setup → Integrations first.");
  }

  const hub = getHubDetailState();
  const rawInvoices = Array.isArray(hub.invoices) ? hub.invoices : [];
  const eligible = rawInvoices
    .filter((row) => row && typeof row === "object" && invoiceEligibleForXeroPaymentSync(row as Record<string, unknown>))
    .map((row) => asHubInvoice(row))
    .filter((row): row is XeroPullInvoiceInput => Boolean(row))
    .filter((row) => !validateInvoiceForXeroPaymentPull(row));

  const targets = prioritizeInvoices(eligible).slice(0, maxInvoices);
  const results: XeroPaymentSyncInvoiceResult[] = [];
  let updated = 0;
  let paymentsAdded = 0;
  let skipped = 0;
  let failed = 0;

  const invoiceMap = new Map<string, Record<string, unknown>>();
  for (const row of rawInvoices) {
    if (row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string") {
      invoiceMap.set((row as { id: string }).id, row as Record<string, unknown>);
    }
  }

  for (const invoice of targets) {
    try {
      const pull = await pullXeroPaymentsForInvoice(invoice);
      const current = invoiceMap.get(invoice.id);
      if (!current) {
        results.push({
          invoiceId: invoice.id,
          invoiceRef: invoice.ref,
          ok: false,
          error: "Invoice disappeared from hub during sync.",
        });
        failed += 1;
        continue;
      }

      const changed =
        pull.addedCount > 0 ||
        pull.paymentStatus !== invoice.paymentStatus ||
        pull.status !== invoice.status ||
        pull.paidAmount !== (invoice.paidAmount ?? 0);

      invoiceMap.set(invoice.id, {
        ...current,
        payments: pull.payments,
        paidAmount: pull.paidAmount,
        paymentStatus: pull.paymentStatus,
        status: pull.status,
        xeroInvoiceId: pull.xeroInvoiceId,
        xeroInvoiceNumber: pull.xeroInvoiceNumber,
      });

      if (pull.addedCount > 0) {
        appendAuditEvent({
          actor,
          action: "xero payment pull",
          recordType: "invoice",
          recordId: invoice.id,
          summary: `${invoice.ref}: auto-sync imported ${pull.addedCount} Xero payment(s), skipped ${pull.skippedCount}.`,
          source: "cron",
          importance: "high",
        });
      }

      if (changed) updated += 1;
      paymentsAdded += pull.addedCount;
      skipped += pull.skippedCount;
      results.push({
        invoiceId: invoice.id,
        invoiceRef: invoice.ref,
        ok: true,
        addedCount: pull.addedCount,
        skippedCount: pull.skippedCount,
        conflictCount: pull.conflicts.length,
        paymentStatus: pull.paymentStatus,
        status: pull.status,
      });
    } catch (error) {
      failed += 1;
      results.push({
        invoiceId: invoice.id,
        invoiceRef: invoice.ref,
        ok: false,
        error: error instanceof Error ? error.message : "Unable to pull Xero payments.",
      });
    }
  }

  if (updated > 0) {
    saveHubDetailState({
      ...hub,
      invoices: rawInvoices.map((row) => {
        if (!row || typeof row !== "object") return row;
        const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : "";
        return id && invoiceMap.has(id) ? invoiceMap.get(id) : row;
      }),
      integrationSettings: {
        ...(hub.integrationSettings && typeof hub.integrationSettings === "object"
          ? (hub.integrationSettings as Record<string, unknown>)
          : {}),
        xeroLastSync: new Date().toISOString(),
      },
    });
  }

  const finishedAt = new Date().toISOString();
  const run: XeroPaymentSyncRun = {
    id: `xero-pay-${Date.now()}`,
    actor,
    startedAt,
    finishedAt,
    ok: failed === 0,
    scanned: eligible.length,
    attempted: targets.length,
    updated,
    paymentsAdded,
    skipped,
    failed,
    results,
  };

  syncStore.runs = [run, ...syncStore.runs].slice(0, MAX_RUNS);
  if (run.ok || paymentsAdded > 0) {
    syncStore.lastSuccessfulAt = finishedAt;
  }
  writeServerStore(STORE_NAME, syncStore);

  appendAuditEvent({
    actor,
    action: "xero payment sync",
    recordType: "integration",
    recordId: "xero",
    summary: `Xero payment sync: ${paymentsAdded} payment(s) on ${updated} invoice(s), ${failed} failed, ${targets.length} checked.`,
    source: actor.toLowerCase().includes("cron") ? "cron" : "web",
    importance: paymentsAdded > 0 ? "high" : "normal",
  });

  return run;
}
