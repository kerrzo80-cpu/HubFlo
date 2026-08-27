import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { leanHubStateForOfficePoll } from "@/lib/hub-poll-lean";

describe("leanHubStateForOfficePoll", () => {
  it("drops takeoff/BoQ maps and slims schedule rows", () => {
    const lean = leanHubStateForOfficePoll({
      quoteCostCentres: {
        q1: [{ id: "c1", lines: [{ a: 1 }], takeoffDocuments: [{ x: 1 }], takeoffRows: [1, 2, 3] }],
      },
      jobCostCentres: {
        j1: [{ id: "c1", materials: Array.from({ length: 200 }, (_, i) => ({ id: String(i) })) }],
      },
      simproExports: [{ id: "e1", payload: "x".repeat(10_000) }],
      quoteSections: { q1: [{ id: "s1" }] },
      jobSchedulePlans: {
        j1: [
          {
            id: "a1",
            employeeId: "e1",
            employeeName: "Sam",
            startDate: "2026-08-01",
            startTime: "08:00",
            endDate: "2026-08-01",
            endTime: "16:00",
            hugeBlob: "y".repeat(5000),
            nested: { keep: false },
          },
        ],
      },
      jobReviews: { j1: { chris: true } },
      employees: [{ id: "e1", name: "Sam" }],
    } as never);

    assert.equal(lean.hubPollLean, true);
    assert.equal(lean.quoteCostCentres, undefined);
    assert.equal(lean.jobCostCentres, undefined);
    assert.equal(lean.simproExports, undefined);
    assert.equal(lean.quoteSections, undefined);
    assert.deepEqual(lean.jobReviews, { j1: { chris: true } });
    const row = (lean.jobSchedulePlans as Record<string, Array<Record<string, unknown>>>).j1[0];
    assert.equal(row.id, "a1");
    assert.equal(row.employeeId, "e1");
    assert.equal(row.hugeBlob, undefined);
    assert.equal(row.nested, undefined);
  });

  it("hub GET uses lean poll helper", () => {
    const route = readFileSync(path.join(process.cwd(), "src/app/api/hub-state/route.ts"), "utf8");
    assert.match(route, /leanHubStateForOfficePoll/);
  });
});
