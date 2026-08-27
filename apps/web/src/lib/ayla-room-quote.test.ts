import test from "node:test";
import assert from "node:assert/strict";

import {
  seededPricingProfiles,
  seededSimproEstimateMappings,
  type EstimateRecord,
} from "@hubflo/domain";

import { roleAccess } from "@/lib/access";
import {
  addSurveyScopeCapability,
  buildRoomQuoteCapability,
  setSurveyRoomCapability,
  startSurveyCapability,
} from "@/lib/blake-core/ayla-survey-quote-capabilities";
import {
  adjustQuoteLabourCapability,
  readQuoteBuildUpCapability,
} from "@/lib/blake-core/ayla-quote-edit-capabilities";
import { resetHubDetailState } from "@/lib/hub-detail-store";
import {
  getSurvey,
  resetSurveyEstimatorStoreForTests,
  saveEstimateRecord,
} from "@/lib/survey-estimator-store";

const actor = {
  id: "ayla-acceptance-owner",
  name: "Ayla Acceptance Owner",
  tenantId: "ayla-acceptance-tenant",
  channel: "web_text" as const,
};

const context = {
  actor,
  access: roleAccess["Owner/Admin"],
  conversationId: "ayla-bathroom-acceptance",
  confirmed: true,
};

test("Ayla bathroom survey builds one client cost centre and keeps labour/material detail internal", async () => {
  resetHubDetailState();
  resetSurveyEstimatorStoreForTests();

  const started = await startSurveyCapability.execute(startSurveyCapability.parse({
    customerName: "Monday Acceptance Customer",
    siteAddress: "17 Acceptance Street, Aberdeen",
    customerRequirements: "Full bathroom refurbishment with replacement WC and shower works.",
    jobType: "Bathroom or wet room",
    market: "Domestic",
  }), context);

  await setSurveyRoomCapability.execute(setSurveyRoomCapability.parse({
    survey: started.id,
    name: "Bathroom",
    lengthM: 2.4,
    widthM: 1.9,
    heightM: 2.35,
  }), context);

  await addSurveyScopeCapability.execute(addSurveyScopeCapability.parse({
    survey: started.id,
    items: [
      {
        taskType: "Replace WC",
        roomOrArea: "Bathroom",
        trade: "Plumbing/Heating",
        quantity: 1,
        notes: "Remove existing WC and install replacement WC, reconnect, test and commission.",
        status: "Confirmed",
      },
      {
        taskType: "Install shower tray",
        roomOrArea: "Bathroom",
        trade: "Plumbing/Heating",
        quantity: 1,
        notes: "Install new shower tray and waste and alter pipework locally to suit.",
        status: "Confirmed",
      },
    ],
  }), context);

  const survey = getSurvey(actor.tenantId, started.id);
  assert.ok(survey);
  assert.equal(survey.rooms.length, 1);
  assert.equal(survey.rooms[0]?.name, "Bathroom");
  assert.equal(survey.scopeItems.length, 2);

  const pricing = seededPricingProfiles.find((item) => item.id === "domestic-small-works");
  assert.ok(pricing);
  const now = new Date().toISOString();
  const firstScope = survey.scopeItems[0]!;

  const estimate: EstimateRecord = {
    id: "estimate-ayla-bathroom-acceptance",
    tenantId: actor.tenantId,
    reference: "EST-AYLA-BATHROOM-ACCEPTANCE",
    surveyId: survey.id,
    sourceSurveyVersion: survey.version,
    version: 1,
    status: "Draft",
    pricingProfile: pricing,
    scopeOfWorks: survey.scopeItems.map((item) => `${item.taskType} - ${item.roomOrArea}`),
    questions: [],
    assumptions: [],
    exclusions: [],
    riskNotes: [],
    materialLines: [{
      id: "estimate-material-bathroom-sundries",
      costCentre: "Bathrooms",
      trade: "Plumbing/Heating",
      description: "Bathroom plumbing materials and sundries",
      quantity: 1,
      unit: "item",
      unitCost: 100,
      markupPercent: 20,
      status: "Confirmed",
      sourceType: "Scope item",
      sourceId: firstScope.id,
      calculationExplanation: "Acceptance fixture for a priced bathroom material allowance.",
      notes: "Internal build-up only.",
      pricingState: "firm",
      pricingSource: "manual",
      pricedAt: now,
    }],
    labourLines: [{
      id: "estimate-labour-bathroom-plumber",
      costCentre: "Bathrooms",
      trade: "Plumbing/Heating",
      labourType: "Plumber",
      description: "Bathroom installation labour",
      hours: 16,
      costRate: 38,
      sellRate: 70,
      status: "Allowance",
      calculationBasis: "Acceptance fixture: 16 plumber hours.",
      sourceType: "Scope item",
      sourceId: firstScope.id,
      notes: "Internal build-up only.",
    }],
    corrections: [],
    generationRuns: [],
    simproMappings: seededSimproEstimateMappings,
    createdAt: now,
    updatedAt: now,
  };
  saveEstimateRecord(actor.tenantId, estimate);

  const built = await buildRoomQuoteCapability.execute({ estimate: estimate.id }, context);
  assert.equal(built.costCentres.length, 1);
  assert.equal(built.rooms.length, 1);
  assert.equal(built.rooms[0], "Bathroom");
  assert.equal(built.costCentres[0]?.name, "Bathroom");
  assert.match(String(built.costCentres[0]?.clientDescription || ""), /• Replace WC/i);
  assert.match(String(built.costCentres[0]?.clientDescription || ""), /• Install shower tray/i);

  const hiddenLines = Array.isArray(built.costCentres[0]?.lines) ? built.costCentres[0].lines : [];
  assert.equal(hiddenLines.length, 2);
  assert.ok(hiddenLines.every((line) => line.internalOnly === true));
  assert.equal(built.quote.value, 1240);

  const before = await readQuoteBuildUpCapability.execute({ quote: built.quote.ref }, context);
  assert.equal(before.centres.length, 1);
  assert.equal(before.centres[0]?.name, "Bathroom");
  const labour = before.centres[0]?.lines.find((line) => line.kind === "labour");
  assert.ok(labour?.id);
  assert.equal(labour.quantity, 16);

  const changed = await adjustQuoteLabourCapability.execute({
    quote: built.quote.ref,
    lineId: labour.id,
    deltaHours: -4,
    reason: "Acceptance test: reduce Bathroom plumber labour by four hours.",
  }, context);

  assert.equal(changed.quote.id, built.quote.id, "Ayla must update the same Draft quote, never create a duplicate");
  assert.equal(changed.previousHours, 16);
  assert.equal(changed.hours, 12);
  assert.equal(changed.changeHours, -4);
  assert.equal(changed.quote.value, 960, "Four hours at £70 must reduce the quote by exactly £280");

  const after = await readQuoteBuildUpCapability.execute({ quote: built.quote.ref }, context);
  assert.equal(after.quote.id, built.quote.id);
  assert.equal(after.centres.length, 1);
  assert.equal(after.centres[0]?.name, "Bathroom");
  assert.equal(after.centres[0]?.lines.find((line) => line.id === labour.id)?.quantity, 12);
  assert.equal(after.quote.value, 960);
});