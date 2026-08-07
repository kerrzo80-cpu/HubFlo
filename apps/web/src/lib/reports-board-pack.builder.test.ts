import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildManagerBoardPackRows,
  DEFAULT_OVERHEAD_PERCENT,
} from "./reports-board-pack";

describe("buildManagerBoardPackRows", () => {
  it("builds executive rows from a snapshot", () => {
    const pack = buildManagerBoardPackRows({
      asAt: "2026-08-06T12:00:00.000Z",
      snapshot: {
        invoices: [
          {
            status: "Sent",
            chargeTotal: 1000,
            paidAmount: 200,
            vatRate: 20,
            ref: "INV-100",
            customer: "Acme",
            payments: [{ amount: 200, source: "xero" }],
          },
          {
            status: "Draft",
            chargeTotal: 500,
            ref: "INV-101",
          },
        ],
        jobs: [
          {
            id: "job-1",
            ref: "J-100",
            customer: "Acme",
            site: "Site A",
            description: "Boiler",
            manager: "Dave",
            status: "Ready to invoice",
            health: "green",
            value: 2400,
            next: "Invoice",
            due: "This week",
          },
          {
            id: "job-2",
            ref: "J-200",
            customer: "Beta",
            site: "Site B",
            description: "Service",
            manager: "Dave",
            status: "In progress",
            health: "amber",
            value: 800,
            next: "On site",
            due: "Today",
          },
        ],
        businessSettings: { overheadPercent: 15 },
        variationPortalPending: 2,
        variationPortalSell: 450,
        paymentSourceTotals: { xero: 200, manual: 50 },
      },
    });

    assert.equal(pack.asAt, "2026-08-06T12:00:00.000Z");
    assert.match(pack.title, /as at 2026-08-06T12:00:00.000Z/);
    assert.equal(pack.overheadPercent, 15);
    assert.ok(pack.rows.some((row) => row[0] === "Executive" && row[1] === "Cash owed"));
    assert.ok(pack.rows.some((row) => row[0] === "Executive" && row[1] === "Ready to invoice jobs" && row[2] === 1));
    assert.ok(pack.rows.some((row) => row[0] === "Variations" && row[2] === 2));
    assert.ok(pack.rows.some((row) => row[0] === "Cash reconcile" && row[1] === "xero"));
  });

  it("uses DEFAULT_OVERHEAD_PERCENT when settings omit overhead", () => {
    const pack = buildManagerBoardPackRows({
      snapshot: {
        invoices: [{ status: "Sent", chargeTotal: 1000, vatRate: 0 }],
        jobs: [],
      },
    });
    assert.equal(pack.overheadPercent, DEFAULT_OVERHEAD_PERCENT);
    assert.match(pack.overheadLabel, /12%/);
  });
});
