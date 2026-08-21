import assert from "node:assert/strict";
import test from "node:test";

import { roleAccess } from "@/lib/access";
import { getJobOfficeUpdates, resetJobOfficeUpdatesForTests } from "@/lib/job-office-updates";
import { createJob, createQuote, getJobs, getQuotes, resetWorkflowStore, saveJob } from "@/lib/workflow-data";
import { writeServerStore } from "@/lib/server-store";
import { writeServerStore } from "@/lib/server-store";

import { requireJobFromHumanReference } from "./blake-core/entity-resolution";
import { humanEntityCapabilities } from "./blake-core/human-entity-capabilities";
import { jobUpdateCapabilities } from "./blake-core/job-update-capabilities";
import { operatorCapabilities } from "./blake-core/operator-capabilities";
import { createBlakeCapabilityRegistry } from "./blake-core/registry";

const registry = createBlakeCapabilityRegistry([
  ...humanEntityCapabilities,
  ...operatorCapabilities,
  ...jobUpdateCapabilities,
]);

const context = {
  actor: {
    id: "human-resolution-owner",
    name: "Human Resolution Owner",
    tenantId: "human-resolution-tenant",
    channel: "mobile_voice" as const,
  },
  access: roleAccess["Owner/Admin"],
};

function seedHelenBallJob() {
  resetWorkflowStore();
  resetJobOfficeUpdatesForTests();
  saveJob({
    id: "job-helen-ball",
    ref: "J-1141",
    customer: "Ball, Helen",
    site: "79 Keithleigh Gardens Pitmedden Ellon AB41 7GF",
    description: "System flush",
    manager: "Office",
    status: "Completed",
    health: "green",
    value: 850,
    next: "Three-person review required before Ready to invoice.",
    due: "Imported",
  });
}

test("natural first-name surname resolves a surname-first imported job", () => {
  seedHelenBallJob();
  const job = requireJobFromHumanReference("Helen Ball");
  assert.equal(job.ref, "J-1141");
  assert.equal(job.customer, "Ball, Helen");
});

test("Blake global search finds Ball, Helen when the user says Helen Ball", async () => {
  seedHelenBallJob();
  const result = await registry.execute<{ matches: Array<{ type: string; ref?: string; title: string }> }>(
    "search_nexa_records",
    { query: "Helen Ball", types: ["job"], limit: 10 },
    context,
  );
  assert.equal(result.ok, true);
  assert.ok(result.data?.matches.some((item) => item.type === "job" && item.ref === "J-1141" && item.title === "Ball, Helen"));
});

test("Blake can add a note using only the natural customer name", async () => {
  seedHelenBallJob();
  const result = await registry.execute<Record<string, unknown>>(
    "add_job_note",
    {
      job: "Helen Ball",
      text: "Not to invoice before speaking to Errol.",
      noteType: "Follow-up",
      priority: "High",
      followUpRequired: true,
    },
    context,
  );
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.data?.ref, "J-1141");
  const updates = getJobOfficeUpdates(context.actor.tenantId, "J-1141");
  assert.equal(updates.notes.length, 1);
  assert.equal(updates.notes[0]?.text, "Not to invoice before speaking to Errol.");
  assert.equal(updates.notes[0]?.attentionStatus, "Open");
});

test("Blake can update a job by natural customer name rather than J-reference", async () => {
  seedHelenBallJob();
  const result = await registry.execute<Record<string, unknown>>(
    "update_job",
    { ref: "Helen Ball", next: "Speak to Errol before invoicing" },
    { ...context, confirmed: true },
  );
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(getJobs().find((job) => job.ref === "J-1141")?.next, "Speak to Errol before invoicing");
});

test("Blake can update a quote by natural customer wording rather than Q-reference", async () => {
  resetWorkflowStore();
  const quote = createQuote({
    customer: "Ball, Helen",
    description: "Bathroom alteration",
    owner: "Office",
    status: "Draft",
    value: 1200,
    next: "Review",
    due: "Friday",
  });
  const result = await registry.execute<Record<string, unknown>>(
    "update_quote",
    { ref: "Helen Ball", next: "Call customer before sending" },
    { ...context, confirmed: true },
  );
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(getQuotes().find((item) => item.id === quote.id)?.next, "Call customer before sending");
});

test("partial site wording resolves a unique job without demanding an internal reference", () => {
  seedHelenBallJob();
  assert.equal(requireJobFromHumanReference("Keithleigh Gardens").ref, "J-1141");
  assert.equal(requireJobFromHumanReference("system flush").ref, "J-1141");
});

test("ambiguous human references return real choices instead of making the user find a reference", () => {
  seedHelenBallJob();
  createJob({
    ref: "J-1142",
    customer: "Ball, Helen",
    site: "12 Another Street, Ellon",
    description: "Boiler service",
    manager: "Office",
    status: "Pending",
    health: "blue",
    value: 200,
    next: "Schedule",
    due: "Unscheduled",
  });
  assert.throws(
    () => requireJobFromHumanReference("Helen Ball"),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /more than one nexa job/i);
      assert.match(message, /J-1141/i);
      assert.match(message, /J-1142/i);
      assert.match(message, /do not ask them to look up an internal reference/i);
      return true;
    },
  );
});


test("live Blake rehydrates a newer persisted workflow store before human lookup", () => {
  resetWorkflowStore();
  assert.equal(getJobs().length, 0);
  writeServerStore("workflow-store", {
    jobs: [{
      id: "job-live-helen-ball",
      ref: "J-1141",
      customer: "Ball, Helen",
      site: "79 Keithleigh Gardens Pitmedden Ellon AB41 7GF",
      description: "System flush",
      manager: "Office",
      status: "Completed",
      health: "green",
      value: 850,
      next: "Review",
      due: "Imported",
    }],
    quotes: [],
    purchaseRequests: [],
  });
  const job = requireJobFromHumanReference("Open job Helen Ball");
  assert.equal(job.ref, "J-1141");
  assert.equal(job.customer, "Ball, Helen");
});
