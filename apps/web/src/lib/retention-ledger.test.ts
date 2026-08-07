import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRetentionWithCap,
  buildRetentionPortfolio,
  jobRetentionBalances,
  progressClaimRetainedAmount,
  retentionPortfolioTotals,
} from "./retention-ledger";

test("applyRetentionWithCap: normal percent with no cap", () => {
  const result = applyRetentionWithCap({
    grossClaim: 10000,
    retentionPercent: 5,
    alreadyRetained: 0,
    retentionCapAmount: 0,
  });
  assert.equal(result.retentionAmount, 500);
  assert.equal(result.netClaim, 9500);
  assert.equal(result.capped, false);
});

test("applyRetentionWithCap: stops once cap is reached", () => {
  const first = applyRetentionWithCap({
    grossClaim: 100000,
    retentionPercent: 5,
    alreadyRetained: 0,
    retentionCapAmount: 10000,
  });
  assert.equal(first.retentionAmount, 5000);
  assert.equal(first.capped, false);

  const second = applyRetentionWithCap({
    grossClaim: 100000,
    retentionPercent: 5,
    alreadyRetained: 9000,
    retentionCapAmount: 10000,
  });
  assert.equal(second.retentionAmount, 1000);
  assert.equal(second.capped, true);
  assert.equal(second.netClaim, 99000);

  const afterCap = applyRetentionWithCap({
    grossClaim: 50000,
    retentionPercent: 5,
    alreadyRetained: 10000,
    retentionCapAmount: 10000,
  });
  assert.equal(afterCap.retentionAmount, 0);
  assert.equal(afterCap.netClaim, 50000);
  assert.equal(afterCap.capped, true);
});

test("progressClaimRetainedAmount prefers retentionHeldAmount", () => {
  assert.equal(
    progressClaimRetainedAmount({
      chargeTotal: 9500,
      retentionPercent: 5,
      retentionHeldAmount: 250,
      valuationLines: [{ agreedThisPeriod: 10000 }],
    }),
    250,
  );
});

test("jobRetentionBalances: held minus released", () => {
  const balances = jobRetentionBalances("job-1", [
    {
      sourceType: "job",
      sourceId: "job-1",
      claimType: "progress-claim",
      status: "Sent",
      retentionHeldAmount: 5000,
      ref: "INV-1",
    },
    {
      sourceType: "job",
      sourceId: "job-1",
      claimType: "progress-claim",
      status: "Sent",
      retentionHeldAmount: 5000,
      ref: "INV-2",
    },
    {
      sourceType: "job",
      sourceId: "job-1",
      claimType: "retention-release",
      status: "Sent",
      chargeTotal: 3000,
    },
  ]);
  assert.equal(balances.retained, 10000);
  assert.equal(balances.released, 3000);
  assert.equal(balances.available, 7000);
});

test("buildRetentionPortfolio lists outstanding by job", () => {
  const rows = buildRetentionPortfolio({
    jobs: [
      { id: "job-1", ref: "J-1", customer: "Acme", clientId: "c1" },
      { id: "job-2", ref: "J-2", customer: "Beta", clientId: "c2" },
    ],
    invoices: [
      {
        sourceType: "job",
        sourceId: "job-1",
        claimType: "progress-claim",
        status: "Sent",
        retentionHeldAmount: 10000,
        retentionPercent: 5,
      },
      {
        sourceType: "job",
        sourceId: "job-1",
        claimType: "retention-release",
        status: "Sent",
        chargeTotal: 2000,
      },
      {
        sourceType: "job",
        sourceId: "job-2",
        claimType: "progress-claim",
        status: "Sent",
        retentionHeldAmount: 1500,
        retentionPercent: 3,
      },
    ],
    termsForJob: () => ({ retentionPercent: 5, retentionCapAmount: 15000 }),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.jobRef, "J-1");
  assert.equal(rows[0]?.outstanding, 8000);
  assert.equal(rows[0]?.roomUnderCap, 5000);
  const totals = retentionPortfolioTotals(rows);
  assert.equal(totals.outstanding, 9500);
  assert.equal(totals.jobs, 2);
});
