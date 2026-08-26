import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleNexaAssistantMessage } from "./nexa-assistant";
import { writeServerStore } from "./server-store";
import { upsertTender } from "./tenders-data";

describe("Ask Ayla on an open tender", () => {
  it("offers to write Ayla budget prices after a QS-style price request", async () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });
    const tender = upsertTender({
      id: "tender-blake-ask-slice",
      name: "Douneside House Health Club",
      client: "MacRobert Trust",
      category: "Plumbing",
      area: "Aberdeenshire",
      status: "In Progress",
      owner: "Office",
      bidValue: 0,
      tenderSum: 0,
      boqTitle: "Plumbing(2)",
      boqLines: [
        {
          id: "ask-l1",
          kind: "measured",
          ref: "8/1/A",
          description: "Doc M toilet pack",
          quantity: 1,
          unit: "nr",
          rate: null,
          value: null,
        },
      ],
    });

    const result = await handleNexaAssistantMessage(
      "price this bill using the rate library",
      { id: "office-1", name: "Office" },
      { screenContext: { view: "tenders", tenderId: tender.id } },
    );

    assert.equal(result.action?.kind, "confirm_budget_prices");
    assert.match(result.reply, /Douneside House Health Club/);
    assert.match(result.reply, /1 still blank|Fill 1 blank/i);
    assert.match(result.action?.confirmLabel || "", /Apply Ayla budget prices/);
  });
});
