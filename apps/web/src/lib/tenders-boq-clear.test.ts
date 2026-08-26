import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writeServerStore } from "@/lib/server-store";
import {
  clearBoqFromTender,
  getTender,
  removeTenderDocument,
  upsertTender,
} from "@/lib/tenders-data";

describe("tender BoQ clear and document remove", () => {
  it("clears imported BoQ lines and removes an uploaded document", () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });

    const tender = upsertTender({
      id: "tender-clear-test",
      name: "Clear BoQ test",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeen",
      status: "In Progress",
      owner: "Office",
      bidValue: 100,
      tenderSum: 100,
      boqTitle: "Client BoQ sheet",
      boqLines: [
        {
          id: "l1",
          kind: "measured",
          ref: "1/A",
          description: "Basin",
          quantity: 1,
          unit: "nr",
          rate: 100,
          value: 100,
        },
      ],
      documents: [
        {
          id: "tdoc-boq-1",
          kind: "issued-boq",
          name: "old-boq.xlsx",
          uploadedAt: new Date().toISOString(),
          url: "/api/record-documents/doc-fake/file",
        },
      ],
    });

    assert.equal(tender.boqLines.length, 1);
    assert.equal(tender.documents.length, 1);

    const cleared = clearBoqFromTender(tender.id);
    assert.equal(cleared.boqLines.length, 0);
    assert.equal(cleared.boqTitle, "");
    assert.equal(cleared.bidValue, 0);
    assert.equal(cleared.tenderSum, 0);
    assert.equal(cleared.documents.length, 1, "clearing BoQ must not wipe document uploads");

    const withoutDoc = removeTenderDocument(tender.id, "tdoc-boq-1");
    assert.equal(withoutDoc.documents.length, 0);
    assert.equal(getTender(tender.id)?.documents.length, 0);
  });
});
