import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("convertQuoteToJobServer copies cost centres and optional deposit", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-quote-handoff-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");

  writeServerStore("people-store", {
    clients: [
      {
        id: "client-test",
        name: "Portal Client",
        accountReference: "C-1",
        status: "Active",
        primaryContact: "Taylor Test",
        email: "accounts@example.com",
        phone: "",
        billingAddress: "1 Test Street",
        commercialOwner: "Carol",
        notes: "",
      },
    ],
    clientSites: [
      {
        id: "site-test",
        clientId: "client-test",
        name: "Test Site",
        address: "1 Test Street",
        status: "Active",
        siteContact: "",
        notes: "",
      },
    ],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  writeServerStore("hub-detail-store", {
    invoices: [],
    communications: [],
    jobDeliveryEvents: [],
    quoteCostCentres: {
      "quote-handoff": [
        {
          id: "cc-1",
          name: "Boiler swap",
          lines: [
            {
              id: "line-1",
              catalogItemId: "material-boiler",
              description: "Boiler",
              quantity: 1,
              unitCost: 1000,
              unitSell: 1300,
            },
          ],
        },
      ],
    },
    workflowRules: {
      autoCreateDepositOnAcceptance: true,
      defaultDepositPercent: "30",
    },
    financeSettings: {
      vatRate: "20",
      paymentTermsDays: "14",
      invoicePrefix: "INV",
      invoiceNextNumber: "9001",
    },
  });

  const { createQuote } = await import("./workflow-data");
  const { convertQuoteToJobServer } = await import("./quote-conversion-handoff");
  const { getHubDetailState } = await import("./hub-detail-store");

  const quote = createQuote({
    id: "quote-handoff",
    clientId: "client-test",
    siteId: "site-test",
    customer: "Portal Client",
    description: "Boiler replacement",
    owner: "Errol Watson",
    status: "Accepted",
    value: 1300,
    next: "Await conversion",
    due: "Today",
  });

  const result = convertQuoteToJobServer(quote.id, {
    actor: "Portal Client",
    source: "client portal",
  });

  assert.ok(result);
  assert.equal(result.quote.status, "Converted");
  assert.ok(result.job.id);
  assert.equal(result.handoff.costCentresCopied, 1);
  assert.equal(result.handoff.jobCostCentres.length, 1);
  assert.ok(result.handoff.depositInvoice);
  assert.equal((result.handoff.depositInvoice as { claimType?: string }).claimType, "deposit");

  const hub = getHubDetailState();
  const jobCentres = (hub.jobCostCentres as Record<string, unknown[]>)?.[result.job.id];
  assert.equal(jobCentres?.length, 1);
  assert.equal((hub.invoices as unknown[])?.length, 1);
  assert.equal((hub.communications as unknown[])?.length, 1);
});

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
