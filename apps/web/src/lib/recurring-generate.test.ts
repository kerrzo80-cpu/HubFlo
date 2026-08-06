import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.NEXA_STORE_DIR = mkdtempSync(path.join(tmpdir(), "hubflo-recurring-generate-"));
process.env.NEXA_STORE_PATH = "";
process.env.NEXA_WORKSPACE_MODE = "live";

type WorkflowStoreForTest = {
  jobs: Array<{ id: string; ref: string; customer: string; site: string; manager: string; scheduledDate?: string }>;
  quotes: unknown[];
  purchaseRequests: unknown[];
};

type HubStoreForTest = {
  financeSettings?: Record<string, unknown>;
  invoices?: Array<Record<string, unknown>>;
};

type RecurringStoreForTest = {
  plans: Array<{
    id: string;
    kind: "Job" | "Invoice";
    nextDueDate: string;
    lastGeneratedRef?: string;
  }>;
  deletedIds: string[];
};

test("generateDueRecurringPlans creates due jobs and draft invoices", async (t) => {
  const storeDir = process.env.NEXA_STORE_DIR;
  assert.ok(storeDir);
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { loadServerStore, writeServerStore } = await import("./server-store");
  writeServerStore("people-store", {
    clients: [
      {
        id: "client-test",
        name: "Test Client",
        accountReference: "C-1",
        status: "Active",
        primaryContact: "Taylor Test",
        email: "accounts@example.com",
        phone: "",
        billingAddress: "1 Test Street",
        commercialOwner: "Carol",
        notes: "",
        vatTreatment: "Standard 20%",
        vatRateOverride: "",
      },
    ],
    clientSites: [
      {
        id: "site-test",
        clientId: "client-test",
        name: "Test Site",
        address: "1 Test Street",
        accessNotes: "",
        primaryContact: "Taylor Test",
        serviceLine: "Service",
        nextVisit: "",
        vatTreatment: "Standard 20%",
        vatRateOverride: "",
      },
    ],
    auditEvents: [],
  });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", {
    financeSettings: {
      vatRate: "20",
      paymentTermsDays: "14",
      jobPrefix: "J",
      jobNextNumber: "1001",
      invoicePrefix: "INV",
      invoiceNextNumber: "3001",
    },
    invoices: [],
    communications: [],
    jobDeliveryEvents: [],
  });
  writeServerStore("nexa-recurring-v1", {
    plans: [
      {
        id: "recur-job",
        kind: "Job",
        name: "Annual boiler service",
        customer: "Test Client",
        clientId: "client-test",
        siteId: "site-test",
        site: "Test Site",
        description: "Service boiler",
        frequency: "Yearly",
        nextDueDate: "2026-01-01",
        active: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "recur-invoice",
        kind: "Invoice",
        name: "Monthly maintenance",
        customer: "Test Client",
        clientId: "client-test",
        siteId: "site-test",
        site: "Test Site",
        description: "Monthly retainer",
        frequency: "Monthly",
        nextDueDate: "2026-01-01",
        amount: 120,
        active: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    ],
    deletedIds: [],
  });

  const { generateDueRecurringPlans } = await import("./recurring-generate");
  const result = generateDueRecurringPlans({ asOf: "2026-01-01", actor: "Carol" });

  assert.deepEqual(result.errors, []);
  assert.equal(result.generated.length, 2);
  assert.ok(result.generated.some((item) => item.planId === "recur-job" && item.kind === "Job" && item.ref === "J-1001"));
  assert.ok(result.generated.some((item) => item.planId === "recur-invoice" && item.kind === "Invoice" && item.ref === "INV-3001"));

  const workflow = loadServerStore<WorkflowStoreForTest>("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  assert.equal(workflow.jobs.length, 1);
  const job = workflow.jobs[0];
  assert.ok(job);
  assert.equal(job.customer, "Test Client");
  assert.equal(job.site, "1 Test Street");
  assert.equal(job.manager, "Carol");
  assert.equal(job.scheduledDate, "2026-01-01");

  const hub = loadServerStore<HubStoreForTest>("hub-detail-store", {});
  const invoice = hub.invoices?.[0];
  assert.ok(invoice);
  assert.equal(invoice.ref, "INV-3001");
  assert.equal(invoice.status, "Draft");
  assert.equal(invoice.chargeTotal, 120);
  assert.equal(invoice.vatRate, 20);
  assert.equal(invoice.dueDate, "2026-01-15");

  const recurring = loadServerStore<RecurringStoreForTest>("nexa-recurring-v1", { plans: [], deletedIds: [] });
  const jobPlan = recurring.plans.find((plan) => plan.id === "recur-job");
  const invoicePlan = recurring.plans.find((plan) => plan.id === "recur-invoice");
  assert.equal(jobPlan?.nextDueDate, "2027-01-01");
  assert.equal(jobPlan?.lastGeneratedRef, "J-1001");
  assert.equal(invoicePlan?.nextDueDate, "2026-02-01");
  assert.equal(invoicePlan?.lastGeneratedRef, "INV-3001");
});
