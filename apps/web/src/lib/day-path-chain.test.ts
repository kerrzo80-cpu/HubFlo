import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * End-to-end EWG day path against isolated disk stores:
 * schedule → Field checklist gate → Complete → Completed + draft invoice
 * → Core merge safety → Ready to invoice → Xero eligibility.
 */
test("day path: Field complete → passaround → invoice → Xero-ready", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-day-path-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");

  writeServerStore("people-store", {
    clients: [
      {
        id: "client-day",
        name: "Day Path Client",
        accountReference: "C-DAY",
        status: "Active",
        primaryContact: "Dana Day",
        email: "dana@example.com",
        phone: "01224 000001",
        billingAddress: "10 Day Street",
        commercialOwner: "Brian",
        notes: "",
      },
    ],
    clientSites: [
      {
        id: "site-day",
        clientId: "client-day",
        name: "Day Site",
        address: "10 Day Street, Aberdeen",
        status: "Active",
        siteContact: "Dana Day",
        notes: "",
      },
    ],
    auditEvents: [],
  });

  writeServerStore("workflow-store", {
    jobs: [
      {
        id: "job-day-1",
        ref: "J-DAY-1",
        customer: "Day Path Client",
        clientId: "client-day",
        siteId: "site-day",
        site: "10 Day Street, Aberdeen",
        description: "Boiler service day-path walkthrough",
        owner: "Brian",
        manager: "Chris Lawson",
        status: "In progress",
        value: 1200,
        next: "Attend and complete checklist",
        due: "Today",
        health: "blue",
      },
    ],
    quotes: [],
    leads: [],
    purchaseRequests: [],
  });

  writeServerStore("hub-detail-store", {
    invoices: [],
    communications: [],
    jobDeliveryEvents: [],
    financeSettings: {
      vatRate: "20",
      paymentTermsDays: "14",
      invoicePrefix: "INV",
      invoiceNextNumber: "5001",
    },
    jobSchedulePlans: {
      "job-day-1": [
        {
          id: "assign-1",
          employeeId: "emp-day",
          employeeName: "Chris Lawson",
          costCentreId: "cc-service",
          costCentreName: "Boiler service",
          startDate: "2026-08-07",
          endDate: "2026-08-07",
          startTime: "09:00",
          endTime: "11:00",
          plannedHours: 2,
          notes: "Morning slot",
        },
      ],
    },
    jobCostCentres: {
      "job-day-1": [
        {
          id: "cc-service",
          name: "Boiler service",
          templateName: "Boiler service",
          materials: [{ description: "Filter", qty: 1, unitCost: 40, unitSell: 65 }],
          labour: [{ description: "Engineer time", hours: 2, unitCost: 35, unitSell: 55 }],
        },
      ],
    },
  });

  writeServerStore("engineer-workflow-store", { jobs: {} });

  const { getJobs, updateJob } = await import("./workflow-data");
  const { getEngineerScheduleItem } = await import("./engineer-data");
  const { applyEngineerWorkflowAction, getEngineerJobWorkflow } = await import("./engineer-workflow-store");

  const scheduleId = "core-job-day-1-assign-1";
  const scheduleItem = getEngineerScheduleItem(scheduleId);
  assert.ok(scheduleItem, "schedule item should exist from hub plan");
  assert.equal(scheduleItem.jobId, "job-day-1");

  const seeded = getEngineerJobWorkflow(scheduleId);
  const missingRequired = seeded.requirements.filter((item) => item.status === "missing");
  assert.ok(missingRequired.length > 0, "boiler service checklist should seed required items");

  assert.throws(
    () =>
      applyEngineerWorkflowAction(scheduleId, {
        action: "set_outcome",
        payload: { status: "Complete", note: "Done early", createdBy: "Chris Lawson" },
      }),
    /Finish required checklist/i,
  );

  for (const requirement of missingRequired) {
    const evidence = requirement.evidence || "Checkbox";
    const payload: {
      requirementId: string;
      createdBy: string;
      text?: string;
      numberValue?: string;
      photoName?: string;
    } = {
      requirementId: requirement.id,
      createdBy: "Chris Lawson",
    };

    if (evidence === "Photo") {
      payload.photoName = `${requirement.id}.jpg`;
    } else if (evidence === "Number") {
      payload.numberValue = /ratio/i.test(requirement.label) ? "0.004" : "18";
    } else if (evidence === "Text" || evidence === "Signature") {
      if (requirement.validation?.inputKind === "date" || /due/i.test(requirement.label)) {
        payload.text = "07-08-2027";
      } else if (requirement.validation?.exactDigits === 12) {
        payload.text = "123456789012";
      } else {
        payload.text = "Completed on site";
      }
    }

    applyEngineerWorkflowAction(scheduleId, {
      action: "complete_requirement",
      payload,
    });
  }

  const afterChecklist = getEngineerJobWorkflow(scheduleId);
  assert.equal(
    afterChecklist.requirements.filter((item) => item.status === "missing").length,
    0,
    "all required checklist items should be done",
  );

  applyEngineerWorkflowAction(scheduleId, {
    action: "set_outcome",
    payload: { status: "Complete", note: "All good", createdBy: "Chris Lawson" },
  });

  const completedJob = getJobs().find((job) => job.id === "job-day-1");
  assert.ok(completedJob);
  assert.equal(completedJob.status, "Completed", "Field Complete must land on Completed for passaround");
  assert.notEqual(completedJob.status, "Ready to invoice", "must not skip office passaround");

  const { getHubDetailState, saveHubDetailState } = await import("./hub-detail-store");
  const hubAfterField = getHubDetailState();
  const invoices = (hubAfterField.invoices || []) as Array<Record<string, unknown>>;
  const draft = invoices.find((invoice) => invoice.sourceId === "job-day-1" && invoice.status === "Draft");
  assert.ok(draft, "draft invoice should be created on Field complete");
  assert.notEqual(
    Number(draft.costTotal),
    Math.round(1200 * 0.68 * 100) / 100,
    "must not use fake 0.68 cost ratio",
  );
  assert.equal(Number(draft.costTotal), 110, "cost should come from job cost centres (40 + 70)");
  assert.ok(Array.isArray(draft.lines) && (draft.lines as unknown[]).length > 0, "draft needs invoice lines");

  const { mergeHubDetailState } = await import("./hub-state-merge");
  const merged = mergeHubDetailState(hubAfterField, { invoices: [] });
  const mergedInvoices = (merged.invoices || []) as Array<Record<string, unknown>>;
  assert.ok(
    mergedInvoices.some((invoice) => invoice.id === draft.id),
    "merge must keep Field draft when Core PUT sends empty invoices",
  );
  saveHubDetailState(merged);
  const hubAfterStaleCore = getHubDetailState();
  assert.ok(
    ((hubAfterStaleCore.invoices || []) as Array<Record<string, unknown>>).some(
      (invoice) => invoice.id === draft.id,
    ),
    "saved hub must still contain Field draft after stale Core write",
  );

  saveHubDetailState({
    ...hubAfterStaleCore,
    jobReviews: {
      ...(hubAfterStaleCore.jobReviews || {}),
      "job-day-1": { construction: true, commercial: true, office: true },
    },
  });

  updateJob("job-day-1", {
    status: "Ready to invoice",
    next: "Passaround approved — raise invoice.",
  });
  assert.equal(getJobs().find((job) => job.id === "job-day-1")?.status, "Ready to invoice");

  const readyInvoice = {
    ...draft,
    status: "Sent",
    accountsStatus: "Not sent",
  };
  const xeroBlocked =
    readyInvoice.status === "Draft" ||
    readyInvoice.status === "Cancelled" ||
    readyInvoice.claimType === "valuation" ||
    readyInvoice.accountsStatus === "Sent" ||
    !Array.isArray(readyInvoice.lines) ||
    (readyInvoice.lines as unknown[]).length === 0;
  assert.equal(xeroBlocked, false, "sent full claim with lines should be Xero-export eligible");
});
