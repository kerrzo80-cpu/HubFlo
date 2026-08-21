import assert from "node:assert/strict";
import test from "node:test";

import {
  addJobOfficeNote,
  createJobVariationDraft,
  getJobAttentionAlerts,
  getJobOfficeUpdates,
  resetJobOfficeUpdatesForTests,
  resolveJobAttention,
} from "./job-office-updates";
import { jobUpdateCapabilities } from "./blake-core/job-update-capabilities";

const tenant = "job-updates-test-tenant";
const otherTenant = "job-updates-other-tenant";
const jobRef = "J-1052";

test("actionable job note stays on the job and in Attention until dealt with", () => {
  resetJobOfficeUpdatesForTests();

  const note = addJobOfficeNote({
    tenantId: tenant,
    jobIdentifier: jobRef,
    text: "Customer wants the controls moved to the opposite wall.",
    noteType: "Customer request",
    priority: "High",
    followUpRequired: true,
    createdBy: "Blake Test Owner",
    source: "Blake",
  });

  const before = getJobOfficeUpdates(tenant, jobRef);
  assert.equal(before.notes.length, 1);
  assert.equal(before.notes[0]?.id, note.id);
  assert.equal(before.notes[0]?.attentionStatus, "Open");

  const alerts = getJobAttentionAlerts(tenant);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.type, "Job note");
  assert.equal(alerts[0]?.jobRef, jobRef);
  assert.equal(alerts[0]?.priority, "High");
  assert.match(alerts[0]?.detail || "", /controls moved/i);

  resolveJobAttention({ tenantId: tenant, kind: "note", id: note.id, actor: "Office User" });

  assert.equal(getJobAttentionAlerts(tenant).length, 0);
  const after = getJobOfficeUpdates(tenant, jobRef);
  assert.equal(after.notes.length, 1, "resolving Attention must not delete the note from the job");
  assert.equal(after.notes[0]?.attentionStatus, "Resolved");
  assert.equal(after.notes[0]?.resolvedBy, "Office User");
});

test("informational job note can be saved without creating an Attention item", () => {
  resetJobOfficeUpdatesForTests();

  const note = addJobOfficeNote({
    tenantId: tenant,
    jobIdentifier: jobRef,
    text: "Customer confirmed the plant room key is with reception.",
    followUpRequired: false,
    createdBy: "Blake Test Owner",
    source: "Blake",
  });

  assert.equal(note.attentionStatus, "None");
  assert.equal(getJobAttentionAlerts(tenant).length, 0);
  assert.equal(getJobOfficeUpdates(tenant, jobRef).notes.length, 1);
});

test("spoken variation becomes a draft and remains in Variations Attention until reviewed", () => {
  resetJobOfficeUpdatesForTests();

  const variation = createJobVariationDraft({
    tenantId: tenant,
    jobIdentifier: jobRef,
    description: "Extra pipe boxing requested after opening the wall.",
    createdBy: "Blake Test Owner",
    source: "Blake",
  });

  assert.equal(variation.status, "Draft");
  assert.equal(variation.attentionStatus, "Open");
  assert.equal(variation.estimatedValue, undefined, "NeXa must not invent a variation price");

  const alerts = getJobAttentionAlerts(tenant);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.type, "Variation detected");
  assert.equal(alerts[0]?.attentionKind, "variation");
  assert.match(alerts[0]?.detail || "", /extra pipe boxing/i);

  resolveJobAttention({ tenantId: tenant, kind: "variation", id: variation.id, actor: "Office User" });

  assert.equal(getJobAttentionAlerts(tenant).length, 0);
  const after = getJobOfficeUpdates(tenant, jobRef).variations;
  assert.equal(after.length, 1, "reviewing Attention must not delete the variation from the job");
  assert.equal(after[0]?.status, "In review");
  assert.equal(after[0]?.attentionStatus, "Resolved");
});

test("job notes and variation alerts are isolated by tenant", () => {
  resetJobOfficeUpdatesForTests();

  addJobOfficeNote({
    tenantId: tenant,
    jobIdentifier: jobRef,
    text: "Private company note.",
    createdBy: "Tenant A",
    source: "Blake",
  });
  createJobVariationDraft({
    tenantId: tenant,
    jobIdentifier: jobRef,
    description: "Private company variation.",
    createdBy: "Tenant A",
    source: "Blake",
  });

  assert.equal(getJobOfficeUpdates(otherTenant, jobRef).notes.length, 0);
  assert.equal(getJobOfficeUpdates(otherTenant, jobRef).variations.length, 0);
  assert.equal(getJobAttentionAlerts(otherTenant).length, 0);
});

test("Blake exposes low-friction note capture but requires confirmation for variations", () => {
  const byName = new Map(jobUpdateCapabilities.map((capability) => [capability.definition.name, capability.definition]));

  const note = byName.get("add_job_note");
  assert.equal(note?.mode, "write");
  assert.equal(note?.requiresConfirmation, false);
  assert.deepEqual(note?.requiredPermissions, ["canEditJobs"]);

  const variation = byName.get("create_job_variation");
  assert.equal(variation?.mode, "write");
  assert.equal(variation?.requiresConfirmation, true);
  assert.deepEqual(variation?.requiredPermissions, ["canEditJobs"]);

  const read = byName.get("list_job_updates");
  assert.equal(read?.mode, "read");
  assert.equal(read?.requiresConfirmation, false);
});
