import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SIMPRO_EOD_ENTITIES, parseSimproEodEntities } from "@/lib/simpro-eod-refresh";

describe("simpro eod refresh helpers", () => {
  it("exposes the full working-set entity list", () => {
    assert.deepEqual(SIMPRO_EOD_ENTITIES, [
      "leads",
      "quotes",
      "jobs",
      "schedules",
      "invoices",
      "clients",
      "sites",
    ]);
  });

  it("filters unknown entities from a cron body", () => {
    assert.deepEqual(parseSimproEodEntities(["jobs", "schedules", "nope"]), ["jobs", "schedules"]);
    assert.equal(parseSimproEodEntities([]), undefined);
    assert.equal(parseSimproEodEntities("jobs"), undefined);
  });
});
