import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("Won tender creates Pending Core job and can reopen without deleting it", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-tender-won-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  const { convertTenderToPendingJob, getTender, updateTender, upsertTender } = await import("./tenders-data");
  const { getJobs, getJob } = await import("./workflow-data");

  function seedTender(id: string) {
    return upsertTender({
      id,
      name: "Queens Terrace Heating",
      client: "Matt McDonald",
      category: "Heating",
      area: "Aberdeen",
      status: "In Progress",
      owner: "Office",
      materialsNote: "3 Queens Terrace",
      boqTitle: "Ground Floor Heating",
      boqLines: [
        {
          id: "l1",
          kind: "measured",
          ref: "1/A",
          description: "Radiator",
          quantity: 2,
          unit: "nr",
          rate: 150,
          value: 300,
        },
      ],
    });
  }

  const converted = convertTenderToPendingJob(seedTender("tender-won-1").id);
  assert.equal(converted.alreadyConverted, false);
  assert.ok(converted.job);
  assert.equal(converted.job?.status, "Pending");
  assert.equal(converted.job?.customer, "Matt McDonald");
  assert.equal(converted.job?.value, 300);
  assert.equal(converted.job?.sourceTenderId, "tender-won-1");
  assert.match(converted.job?.site || "", /Aberdeen/);
  assert.equal(converted.tender.status, "Won");
  assert.equal(converted.tender.convertedJobId, converted.job?.id);

  const viaStatus = updateTender(seedTender("tender-won-2").id, { status: "Won" });
  assert.equal(viaStatus.status, "Won");
  assert.ok(viaStatus.convertedJobId);
  assert.ok(getJobs().find((row) => row.id === viaStatus.convertedJobId));

  const won = convertTenderToPendingJob(seedTender("tender-won-3").id);
  const reopened = updateTender("tender-won-3", { status: "In Progress" });
  assert.equal(reopened.status, "In Progress");
  assert.equal(reopened.convertedJobId, won.job?.id);
  assert.ok(getJob(won.job!.id));

  writeServerStore("nexa-tenders-v1", {
    tenders: [
      {
        id: "tender-won-orphan",
        name: "Orphan Won",
        client: "Client",
        category: "Plumbing",
        area: "Aberdeen",
        status: "Won",
        owner: "Office",
        bidValue: 50,
        tenderSum: 50,
        materialsNote: "",
        qualifications: [],
        daywork: { labourPerHour: 45, materialsUpliftPercent: 15, plantUpliftPercent: 15 },
        boqTitle: "",
        boqLines: [
          {
            id: "l1",
            kind: "measured",
            ref: "1",
            description: "Valve",
            quantity: 1,
            unit: "nr",
            rate: 50,
            value: 50,
          },
        ],
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  assert.equal(getTender("tender-won-orphan")?.convertedJobId, undefined);
  const orphan = convertTenderToPendingJob("tender-won-orphan");
  assert.equal(orphan.alreadyConverted, false);
  assert.ok(orphan.job);

  const first = convertTenderToPendingJob(seedTender("tender-won-4").id);
  const countBefore = getJobs().length;
  const second = convertTenderToPendingJob("tender-won-4");
  assert.equal(second.alreadyConverted, true);
  assert.equal(second.job, null);
  assert.equal(second.tender.convertedJobId, first.job?.id);
  assert.equal(getJobs().length, countBefore);
});
