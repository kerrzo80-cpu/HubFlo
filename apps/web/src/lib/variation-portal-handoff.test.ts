import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("applyVariationPortalHandoff updates delivery event and job next", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-variation-handoff-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });
  writeServerStore("workflow-store", {
    jobs: [
      {
        id: "job-var-test",
        ref: "J-TEST",
        customer: "Portal Client",
        site: "1 Test Street",
        description: "Live job",
        manager: "Errol Watson",
        status: "In progress",
        health: "blue",
        value: 5000,
        next: "Track delivery",
        due: "Today",
      },
    ],
    quotes: [],
    purchaseRequests: [],
  });
  writeServerStore("hub-detail-store", {
    invoices: [],
    jobDeliveryEvents: [
      {
        id: "var-event-1",
        jobId: "job-var-test",
        jobRef: "J-TEST",
        kind: "variation",
        actor: "Errol Watson",
        summary: "Extra pipework",
        createdAt: new Date().toISOString(),
        sellValue: 0,
        requiresClientApproval: true,
        clientApprovalStatus: "Sent",
        status: "Sent for approval",
        source: "NeXa",
      },
    ],
  });

  const { applyVariationPortalHandoff } = await import("./variation-portal-handoff");
  const { getHubDetailState } = await import("./hub-detail-store");

  const handoff = applyVariationPortalHandoff({
    id: "portal-1",
    token: "v-test-token",
    variationEventId: "var-event-1",
    jobId: "job-var-test",
    jobRef: "J-TEST",
    summary: "Extra pipework",
    description: "Extra pipework",
    costValue: 400,
    sellValue: 520,
    actor: "Errol Watson",
    status: "Approved",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  assert.equal(handoff.eventUpdated, true);
  assert.equal(handoff.sellApplied, 520);
  assert.equal(handoff.jobNextUpdated, true);

  const hub = getHubDetailState();
  const event = (hub.jobDeliveryEvents as Array<Record<string, unknown>>)?.[0];
  assert.equal(event?.status, "Client approved");
  assert.equal(event?.clientApprovalStatus, "Approved");
  assert.equal(event?.sellValue, 520);
});
