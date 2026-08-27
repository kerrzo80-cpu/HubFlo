import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const storeDir = mkdtempSync(path.join(tmpdir(), "audit-lean-"));
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";

describe("lean audit append", () => {
  let appendAuditEvent: typeof import("./people-data").appendAuditEvent;
  let getAuditEvents: typeof import("./people-data").getAuditEvents;
  let addClientRecord: typeof import("./people-data").addClientRecord;

  before(async () => {
    ({ appendAuditEvent, getAuditEvents, addClientRecord } = await import("./people-data"));
    for (let i = 0; i < 30; i += 1) {
      addClientRecord({
        id: `client-${i}`,
        name: `Client ${i}`,
        status: "Active",
        email: `c${i}@example.com`,
        phone: "",
        notes: "x".repeat(200),
      } as never);
    }
  });

  after(() => {
    try {
      rmSync(storeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("appends audit to lean side store without rewriting the fat people-store clients blob", () => {
    const peoplePath = path.join(storeDir, "people-store.json");
    const beforePeople = readFileSync(peoplePath, "utf8");

    const event = appendAuditEvent({
      actor: "Tester",
      action: "reviewed",
      recordType: "job",
      recordId: "job-1",
      summary: "construction approved",
      source: "test",
      importance: "normal",
    });
    assert.equal(event.summary, "construction approved");
    assert.equal(getAuditEvents()[0]?.id, event.id);

    const lean = readFileSync(path.join(storeDir, "nexa-audit-events-v1.json"), "utf8");
    assert.match(lean, /construction approved/);

    const afterPeople = readFileSync(peoplePath, "utf8");
    assert.equal(afterPeople, beforePeople);
  });
});
