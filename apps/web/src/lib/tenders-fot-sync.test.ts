import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writeServerStore } from "@/lib/server-store";
import {
  getTender,
  listTenders,
  markTenderSubmitted,
  updateBoqLine,
  upsertTender,
} from "@/lib/tenders-data";
import { computeBoqTotal } from "@/lib/tenders-types";

describe("Tender sum (FoT) syncs to priced BoQ", () => {
  it("overwrites stale manual FoT on load and when BoQ rates change", () => {
    writeServerStore("nexa-tenders-v1", {
      tenders: [
        {
          id: "tender-fot-sync",
          name: "FoT sync test",
          client: "Burns",
          category: "Plumbing",
          area: "Aberdeen",
          status: "In Progress",
          owner: "Office",
          bidValue: 80000,
          tenderSum: 80000,
          materialsNote: "",
          qualifications: [],
          daywork: { labourPerHour: 45, materialsUpliftPercent: 15, plantUpliftPercent: 15 },
          boqTitle: "Test BoQ",
          boqLines: [
            {
              id: "l1",
              kind: "measured",
              ref: "1/A",
              description: "Basin",
              quantity: 1,
              unit: "nr",
              rate: 111000,
              value: 111000,
            },
          ],
          documents: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    const loaded = listTenders().find((row) => row.id === "tender-fot-sync");
    assert.ok(loaded);
    assert.equal(loaded.tenderSum, 111000);
    assert.equal(loaded.bidValue, 111000);

    const updated = updateBoqLine("tender-fot-sync", "l1", { rate: 50000 });
    const nextTotal = computeBoqTotal(updated.boqLines);
    assert.equal(nextTotal, 50000);
    assert.equal(updated.tenderSum, 50000);
    assert.equal(updated.bidValue, 50000);

    const submitted = markTenderSubmitted("tender-fot-sync", { tenderSum: 1 });
    assert.equal(submitted.tenderSum, 50000);
    assert.equal(submitted.status, "Sent");
    assert.equal(getTender("tender-fot-sync")?.tenderSum, 50000);
  });

  it("forces FoT to BoQ total even if upsert passes a manual tenderSum", () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });
    const tender = upsertTender({
      id: "tender-fot-upsert",
      name: "Upsert FoT",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeen",
      status: "Not Started",
      owner: "Office",
      bidValue: 1,
      tenderSum: 99999,
      boqLines: [
        {
          id: "l1",
          kind: "measured",
          ref: "1",
          description: "Pipe",
          quantity: 2,
          unit: "m",
          rate: 10,
          value: 20,
        },
      ],
    });
    assert.equal(tender.tenderSum, 20);
    assert.equal(tender.bidValue, 20);
  });
});
