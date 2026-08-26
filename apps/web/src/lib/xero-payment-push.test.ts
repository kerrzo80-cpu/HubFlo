import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("maybePushSumUpPaymentToXero creates Xero payment when invoice is linked", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-xero-push-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  process.env.XERO_PAYMENT_ACCOUNT_CODE = "090";
  t.after(() => {
    rmSync(storeDir, { recursive: true, force: true });
    delete process.env.XERO_PAYMENT_ACCOUNT_CODE;
  });

  const { writeServerStore } = await import("./server-store");
  writeServerStore("people-store", { clients: [], clientSites: [], auditEvents: [] });
  writeServerStore("hub-detail-store", {
    invoices: [
      {
        id: "inv-push-1",
        ref: "INV-PUSH-1",
        customer: "Acme",
        status: "Sent",
        accountsStatus: "Sent",
        xeroInvoiceId: "xero-inv-1",
        chargeTotal: 100,
        vatRate: 20,
        paymentStatus: "Paid",
        paidAmount: 120,
        payments: [
          {
            id: "sumup-TX-PUSH",
            paidAt: "2026-08-07",
            amount: 120,
            method: "SumUp",
            reference: "TX-PUSH",
            source: "sumup",
            sourcePaymentId: "sumup:TX-PUSH",
          },
        ],
      },
      {
        id: "inv-pending-1",
        ref: "INV-PENDING-1",
        customer: "Acme",
        status: "Sent",
        accountsStatus: "Not sent",
        chargeTotal: 50,
        vatRate: 20,
        paymentStatus: "Paid",
        paidAmount: 60,
        payments: [
          {
            id: "sumup-TX-PENDING",
            paidAt: "2026-08-07",
            amount: 60,
            method: "SumUp",
            source: "sumup",
            sourcePaymentId: "sumup:TX-PENDING",
          },
        ],
      },
    ],
    financeSettings: { xeroPaymentAccountCode: "090" },
  });
  writeServerStore("nexa-xero-auth-v1", {
    accessToken: "test-token",
    tenantId: "test-tenant",
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method || "GET"} ${url}`);
    if (url.includes("/Accounts")) {
      return new Response(
        JSON.stringify({
          Accounts: [{ AccountID: "acc-1", Code: "090", Name: "Business Bank", Type: "BANK", Status: "ACTIVE" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/Invoices?")) {
      return new Response(JSON.stringify({ Invoices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/Payments") && init?.method === "POST") {
      const payload = JSON.parse(String(init.body || "{}")) as {
        Payments?: Array<{ Invoice?: { InvoiceID?: string }; Amount?: number; Account?: { Code?: string } }>;
      };
      assert.equal(payload.Payments?.[0]?.Invoice?.InvoiceID, "xero-inv-1");
      assert.equal(payload.Payments?.[0]?.Amount, 120);
      assert.equal(payload.Payments?.[0]?.Account?.Code, "090");
      return new Response(JSON.stringify({ Payments: [{ PaymentID: "xero-pay-99", Status: "AUTHORISED" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { maybePushSumUpPaymentToXero } = await import("./xero-payment-push");
  const { getHubDetailState } = await import("./hub-detail-store");

  const pushed = await maybePushSumUpPaymentToXero({
    invoiceId: "inv-push-1",
    paymentId: "sumup-TX-PUSH",
  });
  assert.equal(pushed.ok, true);
  if (!pushed.ok) return;
  assert.equal(pushed.xeroPaymentId, "xero-pay-99");

  const pending = await maybePushSumUpPaymentToXero({
    invoiceId: "inv-pending-1",
    paymentId: "sumup-TX-PENDING",
  });
  assert.equal(pending.ok, false);
  if (pending.ok) return;
  assert.equal(pending.reason, "invoice_not_in_xero");

  const invoices = (getHubDetailState().invoices || []) as Array<Record<string, unknown>>;
  const linked = invoices.find((row) => row.id === "inv-push-1");
  const waiting = invoices.find((row) => row.id === "inv-pending-1");
  assert.equal(((linked?.payments as Array<Record<string, unknown>>) || [])[0]?.xeroPushStatus, "pushed");
  assert.equal(((waiting?.payments as Array<Record<string, unknown>>) || [])[0]?.xeroPushStatus, "pending_export");
  assert.ok(calls.some((row) => row.startsWith("POST ") && row.includes("/Payments")));
});
