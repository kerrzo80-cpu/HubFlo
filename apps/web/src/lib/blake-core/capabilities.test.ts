import assert from "node:assert/strict";
import test from "node:test";

import { getAccessProfile } from "../access";
import { getHubDetailState, saveHubDetailState } from "../hub-detail-store";
import { createJob } from "../workflow-data";
import { createBlakeCapabilityRegistry } from "./registry";
import { jobProfitabilityCapability, listInvoicesCapability } from "./capabilities";

const registry = createBlakeCapabilityRegistry([listInvoicesCapability, jobProfitabilityCapability]);
const context = {
  actor: { id: "finance-1", name: "Finance user", tenantId: "tenant-1", channel: "mobile_text" as const },
  access: getAccessProfile("Finance"),
};

test("invoice capability returns unpaid totals and excludes valuations", async () => {
  saveHubDetailState({
    ...getHubDetailState(),
    invoices: [
      { id: "inv-1", ref: "INV-1001", customer: "Morrison & Co.", title: "Heating works", status: "Sent", issuedDate: "2026-08-01", dueDate: "2026-08-15", chargeTotal: 1000, vatRate: 20, paidAmount: 200 },
      { id: "inv-2", ref: "INV-1002", customer: "Morrison & Co.", title: "Paid works", status: "Paid", issuedDate: "2026-08-02", dueDate: "2026-08-16", chargeTotal: 500, vatRate: 20, paidAmount: 600 },
      { id: "val-1", ref: "VAL-1001", customer: "Morrison & Co.", title: "Valuation", status: "Sent", claimType: "valuation", issuedDate: "2026-08-03", chargeTotal: 5000, vatRate: 20 },
    ],
  });

  const result = await registry.execute<{ count: number; total: number; owed: number }>(
    "list_invoices",
    { status: "unpaid", asAt: "2026-08-20" },
    context,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.count, 1);
  assert.equal(result.data?.total, 1200);
  assert.equal(result.data?.owed, 1000);
});

test("invoice capability identifies invoices overdue as at a supplied date", async () => {
  const result = await registry.execute<{ count: number; rows: Array<{ ref: string }> }>(
    "list_invoices",
    { status: "overdue", asAt: "2026-08-20" },
    context,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.count, 1);
  assert.equal(result.data?.rows[0]?.ref, "INV-1001");
});

test("job profitability capability finds genuinely tight margins from cost-centre lines", async () => {
  const job = createJob({
    ref: `J-MARGIN-${Date.now()}`, customer: "Margin Test Ltd", site: "Test site", description: "Tight margin test",
    manager: "Brian Kerr", status: "In progress", health: "blue", value: 100, next: "Review", due: "Today",
  });
  const hub = getHubDetailState();
  saveHubDetailState({
    ...hub,
    jobCostCentres: {
      ...((hub.jobCostCentres ?? {}) as Record<string, unknown>),
      [job.id]: [{
        id: `${job.id}-centre`, name: "Plant", templateName: "Plant",
        materials: [{ id: `${job.id}-line`, catalogItemId: "catalog-plant", description: "Plant", quantity: 1, unitCost: 90, unitSell: 100, markupPercent: 0 }],
        labour: [],
      }],
    },
  });

  const result = await registry.execute<{ rows: Array<{ ref: string; marginPercent: number; costDataComplete: boolean }> }>(
    "list_job_profitability",
    { maximumMarginPercent: 15, includeCompleted: false },
    context,
  );

  assert.equal(result.ok, true);
  const row = result.data?.rows.find((item) => item.ref === job.ref);
  assert.equal(row?.marginPercent, 10);
  assert.equal(row?.costDataComplete, true);
});
