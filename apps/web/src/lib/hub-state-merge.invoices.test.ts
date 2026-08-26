import assert from "node:assert/strict";
import test from "node:test";

import { mergeHubDetailState, mergeInvoicesById } from "@/lib/hub-state-merge";

test("mergeInvoicesById keeps Field drafts when Core PUT omits them", () => {
  const server = [
    {
      id: "inv-field-1",
      ref: "INV-100",
      status: "Draft",
      sourceType: "job",
      sourceId: "job-1",
      chargeTotal: 500,
      lines: [{ id: "l1", description: "Work", chargeToClient: 500 }],
    },
  ];
  const client: unknown[] = []; // stale Core autosave with no invoices
  const merged = mergeInvoicesById(server, client) as Array<{ id: string }>;
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "inv-field-1");
});

test("mergeInvoicesById merges by id and preserves Sent accounts status", () => {
  const server = [
    {
      id: "inv-1",
      ref: "INV-1",
      status: "Sent",
      accountsStatus: "Sent",
      xeroInvoiceId: "xero-9",
      chargeTotal: 100,
      lines: [{ id: "a", description: "A" }],
    },
  ];
  const client = [
    {
      id: "inv-1",
      ref: "INV-1",
      status: "Sent",
      accountsStatus: "Not sent",
      chargeTotal: 120,
      lines: [],
    },
    {
      id: "inv-2",
      ref: "INV-2",
      status: "Draft",
      chargeTotal: 50,
      lines: [{ id: "b", description: "B" }],
    },
  ];
  const merged = mergeInvoicesById(server, client) as Array<Record<string, unknown>>;
  assert.equal(merged.length, 2);
  const first = merged.find((row) => row.id === "inv-1");
  assert.ok(first);
  assert.equal(first?.accountsStatus, "Sent");
  assert.equal(first?.xeroInvoiceId, "xero-9");
  assert.equal(first?.chargeTotal, 120);
  // Prefer server lines when client wiped them.
  assert.ok(Array.isArray(first?.lines) && (first?.lines as unknown[]).length === 1);
});

test("mergeHubDetailState merges invoices", () => {
  const merged = mergeHubDetailState(
    {
      invoices: [{ id: "inv-a", ref: "A", status: "Draft" }],
    },
    {
      invoices: [{ id: "inv-b", ref: "B", status: "Draft" }],
    },
  );
  const ids = (merged.invoices as Array<{ id: string }>).map((row) => row.id).sort();
  assert.deepEqual(ids, ["inv-a", "inv-b"]);
});

test("mergeInvoicesById keeps SumUp payments when Core autosave is still Unpaid", () => {
  const server = [
    {
      id: "inv-pay-1",
      ref: "INV-PAY-1",
      status: "Paid",
      paymentStatus: "Paid",
      paidAmount: 120,
      chargeTotal: 100,
      vatRate: 20,
      payments: [
        {
          id: "sumup-TX9",
          source: "sumup",
          sourcePaymentId: "sumup:TX9",
          amount: 120,
          paidAt: "2026-08-07",
          method: "SumUp",
          xeroPaymentId: "xero-pay-1",
        },
      ],
    },
  ];
  const client = [
    {
      id: "inv-pay-1",
      ref: "INV-PAY-1",
      status: "Sent",
      paymentStatus: "Unpaid",
      paidAmount: 0,
      chargeTotal: 100,
      vatRate: 20,
      payments: [],
    },
  ];
  const merged = mergeInvoicesById(server, client) as Array<Record<string, unknown>>;
  const row = merged.find((item) => item.id === "inv-pay-1");
  assert.ok(row);
  assert.equal(row?.paymentStatus, "Paid");
  assert.equal(row?.paidAmount, 120);
  assert.equal(row?.status, "Paid");
  assert.equal((row?.payments as unknown[])?.length, 1);
  assert.equal(((row?.payments as Array<Record<string, unknown>>)[0] || {}).xeroPaymentId, "xero-pay-1");
});
