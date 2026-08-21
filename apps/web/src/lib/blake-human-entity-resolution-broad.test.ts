import assert from "node:assert/strict";
import test from "node:test";

import { roleAccess, type Employee, type EmployeeAvailability } from "@/lib/access";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { createLead, getLead, resetLeadStore } from "@/lib/lead-store";
import { addClientRecord, addClientSiteRecord, getClientSites, getClients } from "@/lib/people-data";
import { createJob, createQuote, getJobs, resetWorkflowStore } from "@/lib/workflow-data";

import {
  requireClientFromHumanReference,
  requireEmployeeFromHumanReference,
  requireInvoiceFromHumanReference,
  requireLeadFromHumanReference,
  requireQuoteFromHumanReference,
  requireSiteFromHumanReference,
} from "./blake-core/entity-resolution";
import { chatWriteCapabilities } from "./blake-core/chat-write-capabilities";
import { humanEntityCapabilities } from "./blake-core/human-entity-capabilities";
import { operatorCapabilities } from "./blake-core/operator-capabilities";
import { createBlakeCapabilityRegistry } from "./blake-core/registry";

const registry = createBlakeCapabilityRegistry([
  ...operatorCapabilities,
  ...chatWriteCapabilities,
  ...humanEntityCapabilities,
]);

const context = {
  actor: {
    id: "broad-human-resolution-owner",
    name: "Human Resolution Owner",
    tenantId: "broad-human-resolution-tenant",
    channel: "mobile_voice" as const,
  },
  access: roleAccess["Owner/Admin"],
};

const availability: EmployeeAvailability = {
  Mon: { active: true, from: "07:30", to: "17:00" },
  Tue: { active: true, from: "07:30", to: "17:00" },
  Wed: { active: true, from: "07:30", to: "17:00" },
  Thu: { active: true, from: "07:30", to: "17:00" },
  Fri: { active: true, from: "07:30", to: "17:00" },
  Sat: { active: false, from: "", to: "" },
  Sun: { active: false, from: "", to: "" },
};

const louise: Employee = {
  id: "emp-human-louise",
  name: "Fraser, Louise",
  role: "Engineer",
  permissions: {},
  profile: {
    email: "louise.human-test@example.com",
    phone: "07700 880001",
    roleLabel: "Heating Engineer",
    availability,
  },
};

function seedBroadHumanEntities() {
  resetWorkflowStore();
  resetLeadStore();

  if (!getClients().some((item) => item.id === "client-human-sarah")) {
    addClientRecord({
      id: "client-human-sarah",
      name: "McDonald, Sarah",
      accountReference: "C-8801",
      status: "Active",
      primaryContact: "McDonald, Sarah",
      email: "sarah.human-test@example.com",
      phone: "07700 880002",
      billingAddress: "22 Riverside Road, Banchory, AB31 5AA",
      commercialOwner: "Human Resolution Owner",
      notes: "Human entity resolver regression customer.",
    });
  }

  if (!getClientSites().some((item) => item.id === "site-human-riverside")) {
    addClientSiteRecord({
      id: "site-human-riverside",
      clientId: "client-human-sarah",
      name: "Riverside Cottage",
      address: "47 Dee View Road, Banchory, AB31 5ZZ",
      accessNotes: "Use side gate.",
      primaryContact: "McDonald, Sarah",
      serviceLine: "Heating upgrade",
      nextVisit: "To be scheduled",
    });
  }

  createJob({
    ref: "J-8801",
    customer: "McDonald, Sarah",
    site: "47 Dee View Road, Banchory, AB31 5ZZ",
    description: "Ground source heating controls upgrade",
    manager: "Fraser, Louise",
    status: "Pending",
    health: "blue",
    value: 4200,
    next: "Schedule works",
    due: "Unscheduled",
  });

  createQuote({
    ref: "Q-8801",
    customer: "McDonald, Sarah",
    description: "Air source heat pump option",
    owner: "Fraser, Louise",
    status: "Draft",
    value: 12500,
    next: "Review design",
    due: "Unscheduled",
  });

  createLead({
    id: "lead-human-patrick",
    ref: "L-8801",
    customerName: "O'Neil, Patrick",
    phone: "07700 880003",
    email: "patrick.human-test@example.com",
    address: "9 Market Lane, Ellon, AB41 9ZZ",
    description: "Kitchen alteration plumbing survey",
    source: "Email",
    status: "Needs scheduling",
    surveyor: "Fraser, Louise",
    surveyDate: "",
    surveyTime: "",
    createdBy: "Human Resolution Owner",
    next: "Book survey",
  }, "Human Resolution Test");

  const hub = getHubDetailState();
  const employees = ((hub.employees ?? []) as Employee[]).filter((item) => item.id !== louise.id && item.id !== "emp-human-louise-two");
  const invoices = ((hub.invoices ?? []) as Array<Record<string, unknown>>).filter((item) => item.id !== "invoice-human-8801");
  saveHubDetailState({
    ...hub,
    employees: [...employees, louise],
    invoices: [
      ...invoices,
      {
        id: "invoice-human-8801",
        ref: "INV-8801",
        customer: "McDonald, Sarah",
        title: "Heating upgrade stage invoice",
        sourceRef: "J-8801",
        status: "Sent",
        paymentStatus: "Unpaid",
        issuedDate: "2026-08-01",
        dueDate: "2026-08-31",
        chargeTotal: 1000,
        vatRate: 20,
        paidAmount: 0,
      },
    ],
  });
}

test("shared resolver handles reversed customer, site, lead, quote, invoice and employee references", () => {
  seedBroadHumanEntities();
  assert.equal(requireClientFromHumanReference("Sarah McDonald").id, "client-human-sarah");
  assert.equal(requireClientFromHumanReference("Sarah").id, "client-human-sarah");
  assert.equal(requireSiteFromHumanReference("Dee View Road").id, "site-human-riverside");
  assert.equal(requireSiteFromHumanReference("Riverside Cottage").id, "site-human-riverside");
  assert.equal(requireLeadFromHumanReference("Patrick O'Neil").ref, "L-8801");
  assert.equal(requireLeadFromHumanReference("kitchen alteration").ref, "L-8801");
  assert.equal(requireQuoteFromHumanReference("heat pump option").ref, "Q-8801");
  assert.equal(requireInvoiceFromHumanReference("Sarah McDonald").ref, "INV-8801");
  assert.equal(requireEmployeeFromHumanReference("Louise Fraser").id, "emp-human-louise");
  assert.equal(requireEmployeeFromHumanReference("Louise").id, "emp-human-louise");
});

test("get_nexa_record uses the same human resolver for every supported entity class", async () => {
  seedBroadHumanEntities();
  const cases: Array<[string, string, string]> = [
    ["client", "Sarah McDonald", "client-human-sarah"],
    ["site", "Dee View Road", "site-human-riverside"],
    ["lead", "Patrick O'Neil", "L-8801"],
    ["quote", "heat pump option", "Q-8801"],
    ["job", "ground source heating controls", "J-8801"],
    ["invoice", "heating upgrade stage", "INV-8801"],
    ["employee", "Louise Fraser", "emp-human-louise"],
  ];

  for (const [type, identifier, expected] of cases) {
    const result = await registry.execute<{ type: string; record: Record<string, unknown> }>(
      "get_nexa_record",
      { type, identifier },
      context,
    );
    assert.equal(result.ok, true, `${type}: ${result.error?.message}`);
    const record = result.data?.record;
    assert.ok(record);
    assert.equal(String(record?.ref || record?.id), expected, type);
  }
});

test("global search finds reversed names and employees without internal references", async () => {
  seedBroadHumanEntities();
  const customerSearch = await registry.execute<{ matches: Array<{ type: string; id: string; ref?: string }> }>(
    "search_nexa_records",
    { query: "Sarah McDonald", types: ["client", "job", "invoice"], limit: 10 },
    context,
  );
  assert.equal(customerSearch.ok, true, customerSearch.error?.message);
  assert.ok(customerSearch.data?.matches.some((item) => item.type === "client" && item.id === "client-human-sarah"));
  assert.ok(customerSearch.data?.matches.some((item) => item.type === "job" && item.ref === "J-8801"));
  assert.ok(customerSearch.data?.matches.some((item) => item.type === "invoice" && item.ref === "INV-8801"));

  const employeeSearch = await registry.execute<{ matches: Array<{ type: string; id: string }> }>(
    "search_nexa_records",
    { query: "Louise Fraser", types: ["employee"], limit: 10 },
    context,
  );
  assert.equal(employeeSearch.ok, true, employeeSearch.error?.message);
  assert.ok(employeeSearch.data?.matches.some((item) => item.type === "employee" && item.id === "emp-human-louise"));
});

test("schedule availability resolves a reversed or partial employee name", async () => {
  seedBroadHumanEntities();
  const result = await registry.execute<{ employeeId: string; employeeName: string }>(
    "check_schedule_availability",
    { employee: "Louise Fraser", date: "2026-08-24" },
    context,
  );
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.data?.employeeId, "emp-human-louise");
  assert.equal(result.data?.employeeName, "Fraser, Louise");
});

test("invoice customer filter accepts reversed stored names", async () => {
  seedBroadHumanEntities();
  const result = await registry.execute<{ count: number; rows: Array<{ ref: string }> }>(
    "list_invoices",
    { status: "all", customer: "Sarah McDonald", asAt: "2026-08-21", limit: 20 },
    context,
  );
  assert.equal(result.ok, true, result.error?.message);
  assert.ok((result.data?.count ?? 0) >= 1);
  assert.ok(result.data?.rows.some((item) => item.ref === "INV-8801"));
});

test("lead updates resolve the lead, surveyor and site independently from human wording", async () => {
  seedBroadHumanEntities();
  const result = await registry.execute<Record<string, unknown>>(
    "update_lead",
    {
      ref: "Patrick O'Neil",
      surveyor: "Louise Fraser",
      siteId: "Riverside Cottage",
      next: "Louise to survey Riverside Cottage",
    },
    { ...context, confirmed: true },
  );
  assert.equal(result.ok, true, result.error?.message);
  const lead = getLead("lead-human-patrick");
  assert.equal(lead?.surveyor, "Fraser, Louise");
  assert.equal(lead?.siteId, "site-human-riverside");
});

test("job creation canonicalises existing customer site and manager from natural wording", async () => {
  seedBroadHumanEntities();
  const result = await registry.execute<Record<string, unknown>>(
    "create_job",
    {
      customer: "Sarah McDonald",
      site: "Riverside Cottage",
      manager: "Louise Fraser",
      description: "Human resolution creation test",
    },
    { ...context, confirmed: true },
  );
  assert.equal(result.ok, true, result.error?.message);
  const created = getJobs().find((item) => item.description === "Human resolution creation test");
  assert.equal(created?.customer, "McDonald, Sarah");
  assert.equal(created?.site, "47 Dee View Road, Banchory, AB31 5ZZ");
  assert.equal(created?.manager, "Fraser, Louise");
});

test("genuine employee ambiguity produces real human choices instead of requesting ids", () => {
  seedBroadHumanEntities();
  const hub = getHubDetailState();
  const employees = (hub.employees ?? []) as Employee[];
  saveHubDetailState({
    ...hub,
    employees: [
      ...employees.filter((item) => item.id !== "emp-human-louise-two"),
      {
        id: "emp-human-louise-two",
        name: "Forbes, Louise",
        role: "Engineer",
        permissions: {},
        profile: { roleLabel: "Service Engineer", availability },
      },
    ],
  });

  assert.throws(
    () => requireEmployeeFromHumanReference("Louise"),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /more than one nexa employee/i);
      assert.match(message, /Fraser, Louise/i);
      assert.match(message, /Forbes, Louise/i);
      assert.match(message, /do not ask them to look up an internal reference/i);
      return true;
    },
  );
});
