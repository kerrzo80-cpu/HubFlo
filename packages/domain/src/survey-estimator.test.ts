import assert from "node:assert/strict";
import test from "node:test";

import {
  reviewSurveyCompletion,
  seededPricingProfiles,
  surveyQuestionsForJobType,
  type SurveyPhoto,
  type SurveyRecord,
} from "./survey-estimator";
import { generateEstimateFromSurvey } from "./estimate-generation";

const now = "2026-07-16T08:00:00.000Z";

function requiredPhotos(): SurveyPhoto[] {
  return ["Existing condition", "Proposed position", "Pipe route", "Boiler data plate", "Gas meter"].map((category, index) => ({
    id: `photo-${index}`,
    category: category as SurveyPhoto["category"],
    fileName: `${category}.jpg`,
    mimeType: "image/jpeg",
    size: 100,
    storageKey: `survey/photo-${index}.jpg`,
    caption: category,
    capturedAt: now,
    surveySection: "Boiler relocation",
  }));
}

function atagSurvey(): SurveyRecord {
  return {
    id: "survey-atag",
    tenantId: "tenant-ewg",
    reference: "SV-3001",
    version: 1,
    status: "Ready for review",
    customerName: "ATAG acceptance customer",
    siteAddress: "1 Acceptance Street, Aberdeen",
    primaryContact: { name: "Site contact", email: "site@example.com", phone: "01224 000000" },
    additionalContacts: [],
    jobLink: { type: "Quote", id: "quote-atag", reference: "Q-ATAG" },
    surveyorName: "Brian Kerr",
    surveyDate: "2026-07-16",
    customerRequirements: "Relocate the existing ATAG boiler into a kitchen cupboard.",
    occupancy: "Occupied",
    market: "Domestic",
    jobType: "Boiler relocation",
    answers: surveyQuestionsForJobType("Boiler relocation").map((question, index) => ({
      id: `answer-${index}`,
      key: question.key,
      section: question.section,
      question: question.question,
      value: question.key === "gas-meter-supply" ? "Gas meter photographed; existing size recorded on survey." : "Confirmed on site.",
      status: "Confirmed",
      notes: "",
      photoIds: [],
      updatedAt: now,
    })),
    rooms: [{
      id: "room-kitchen",
      name: "Kitchen",
      lengthM: 4.2,
      widthM: 3.1,
      heightM: 2.4,
      wallConstruction: "Masonry",
      floorConstruction: "Suspended timber",
      ceilingConstruction: "Plasterboard",
      accessNotes: "Kitchen cupboard and roof access recorded.",
      photoIds: ["photo-0", "photo-1"],
    }],
    scopeItems: [{
      id: "scope-relocate",
      taskType: "Relocate existing ATAG boiler",
      trade: "Plumbing/Heating",
      roomOrArea: "Kitchen",
      existingPosition: "Existing utility position",
      proposedPosition: "Kitchen cupboard",
      quantity: 1,
      dimensions: "Cupboard dimensions recorded",
      status: "Confirmed",
      responsibility: "EWG",
      notes: "Alter hot, cold, heating, condensate and controls.",
      photoIds: ["photo-0", "photo-1"],
    }],
    pipeRuns: [{
      id: "pipe-gas",
      service: "Gas",
      fromLocation: "Gas meter",
      toLocation: "Kitchen cupboard boiler position",
      measuredLengthM: 12,
      pipeSize: "22mm subject to final gas sizing calculation",
      material: "Copper",
      route: "Route photographed and measured on site",
      insulationRequired: false,
      directionChanges: [{ type: "Direction change", quantity: 6 }],
      accessDifficulty: "Restricted",
      fireStopping: false,
      coreDrilling: true,
      makingGood: true,
      measurementStatus: "Measured",
      notes: "Final gas sizing remains a design check.",
      photoIds: ["photo-2", "photo-4"],
    }],
    equipmentItems: [{
      id: "equipment-flue",
      category: "Flue",
      roomOrArea: "Kitchen / roof",
      description: "ATAG-compatible vertical flue terminal, four extensions, four 45-degree bends and roof weathering",
      make: "ATAG",
      model: "TBC",
      supplierCode: "",
      quantity: 1,
      dimensions: "TBC",
      outputOrCapacity: "",
      connectionRequirements: "Manufacturer compatibility confirmation required",
      rfqRequired: true,
      status: "TBC",
      tbcReason: "Exact ATAG boiler model and compatible flue part numbers require supplier confirmation.",
      notes: "Keep all manufacturer-specific components out of confirmed material totals until returned.",
      photoIds: ["photo-0", "photo-2"],
    }],
    photos: requiredPhotos(),
    workByOthers: ["Decoration beyond local making good"],
    assumptions: ["Existing boiler is suitable for relocation subject to manufacturer confirmation"],
    audit: [],
    createdAt: now,
    updatedAt: now,
  };
}

test("ATAG boiler-relocation survey passes essential completion gates while exposing design and RFQ items", () => {
  const review = reviewSurveyCompletion(atagSurvey());
  assert.equal(review.canComplete, true);
  assert.equal(review.canSendToEstimator, true);
  assert.equal(review.blockers.length, 0);
  assert.ok(review.supplierRfqs.some((item) => item.recordId === "equipment-flue"));
  assert.ok(review.designDependencies.some((item) => item.recordId === "equipment-flue"));
  assert.deepEqual(review.workByOthers, ["Decoration beyond local making good"]);
});

test("a captured survey cannot be sent for pricing without a customer outcome and structured scope", () => {
  const survey = atagSurvey();
  survey.customerRequirements = "";
  survey.scopeItems = [];
  const review = reviewSurveyCompletion(survey);

  assert.equal(review.canComplete, true, "Non-safety pricing omissions can remain in a captured survey");
  assert.equal(review.canSendToEstimator, false);
  assert.ok(review.pricingReadinessIssues.some((item) => item.code === "CUSTOMER_REQUIREMENT_REQUIRED"));
  assert.ok(review.pricingReadinessIssues.some((item) => item.code === "SCOPE_REQUIRED"));
});

test("completion blocks an unlinked survey", () => {
  const survey = atagSurvey();
  survey.jobLink = undefined;
  const review = reviewSurveyCompletion(survey);
  assert.equal(review.canComplete, false);
  assert.ok(review.blockers.some((item) => item.code === "JOB_LINK_REQUIRED"));
});

test("TBC values require a reason rather than a guessed answer", () => {
  const survey = atagSurvey();
  const answer = survey.answers.find((item) => item.key === "flue-route");
  assert.ok(answer);
  answer.status = "TBC";
  answer.value = null;
  answer.tbcReason = "";
  const review = reviewSurveyCompletion(survey);
  assert.equal(review.canComplete, false);
  assert.ok(review.blockers.some((item) => item.code === "TBC_REASON_REQUIRED"));
});

test("ATAG boiler relocation generates traceable components and separate trade labour", () => {
  const survey = atagSurvey();
  const pricingProfile = seededPricingProfiles.find((profile) => profile.id === "domestic-small-works");
  assert.ok(pricingProfile);

  const estimate = generateEstimateFromSurvey(survey, pricingProfile, {}, now);
  const gasPipe = estimate.materialLines.find((line) => line.sourceId === "pipe-gas" && line.unit === "m");
  const flueTerminal = estimate.materialLines.find((line) => /vertical flue terminal/i.test(line.description));
  const flueExtensions = estimate.materialLines.find((line) => /vertical flue extension/i.test(line.description));
  const flueBends = estimate.materialLines.find((line) => /45-degree flue bend/i.test(line.description));
  const roofWeathering = estimate.materialLines.find((line) => /roof weathering/i.test(line.description));

  assert.ok(gasPipe);
  assert.equal(gasPipe.quantity, 13.2);
  assert.match(gasPipe.calculationExplanation, /Measured 12m \+ 10% waste/);
  assert.equal(flueTerminal?.quantity, 1);
  assert.equal(flueExtensions?.quantity, 4);
  assert.equal(flueBends?.quantity, 4);
  assert.equal(roofWeathering?.quantity, 1);
  assert.ok([flueTerminal, flueExtensions, flueBends, roofWeathering].every((line) => line?.status === "Supplier RFQ"));
  assert.ok(estimate.labourLines.some((line) => line.labourType === "Plumber"));
  assert.ok(estimate.labourLines.some((line) => line.labourType === "Joiner"));
  assert.ok(estimate.labourLines.some((line) => line.labourType === "Electrician"));
  assert.ok(estimate.materialLines.every((line) => line.sourceId && line.calculationExplanation));
  assert.ok(estimate.labourLines.every((line) => line.sourceId && line.calculationBasis));
  assert.ok(estimate.materialLines.every((line) => !/\bkit\b/i.test(line.description)), "Generated materials must be itemised rather than hidden in generic kits");
});

test("repeated boiler scope lines do not duplicate system chemicals", () => {
  const survey = atagSurvey();
  survey.scopeItems.push({
    ...survey.scopeItems[0]!,
    id: "scope-relocate-second",
    taskType: "Boiler relocation commissioning",
  });
  const pricingProfile = seededPricingProfiles[0]!;
  const estimate = generateEstimateFromSurvey(survey, pricingProfile, {}, now);

  assert.equal(estimate.materialLines.filter((line) => line.description === "Heating system cleaner").length, 1);
  assert.equal(estimate.materialLines.filter((line) => line.description === "Heating system inhibitor").length, 1);
  assert.equal(new Set(estimate.materialLines.map((line) => line.id)).size, estimate.materialLines.length);
});

test("a measured general pipe run generates itemised materials and traceable labour", () => {
  const survey = atagSurvey();
  survey.jobType = "General plumbing";
  survey.customerRequirements = "Alter the heating pipe route to suit the new radiator position.";
  survey.scopeItems = [{
    ...survey.scopeItems[0]!,
    id: "scope-heating-alteration",
    taskType: "Alter heating pipework",
    proposedPosition: "New radiator position",
    notes: "Run new pipework to the relocated radiator position and test.",
  }];
  survey.pipeRuns = [{
    ...survey.pipeRuns[0]!,
    id: "pipe-heating-flow",
    service: "Heating flow",
    fromLocation: "Existing heating circuit",
    toLocation: "Relocated radiator",
    measuredLengthM: 9,
    pipeSize: "15mm",
    accessDifficulty: "Normal",
    coreDrilling: false,
    directionChanges: [{ type: "Elbow", quantity: 4 }],
  }];
  const estimate = generateEstimateFromSurvey(survey, seededPricingProfiles[0]!, {}, now);

  assert.ok(estimate.materialLines.some((line) => line.sourceId === "pipe-heating-flow" && line.unit === "m" && line.quantity === 9.9));
  assert.ok(estimate.materialLines.some((line) => /clips\/supports/i.test(line.description)));
  assert.ok(estimate.materialLines.some((line) => /connection\/adaptor/i.test(line.description) && line.quantity === 2));
  assert.ok(estimate.materialLines.some((line) => /elbow/i.test(line.description) && line.quantity === 4));
  assert.equal(estimate.materialLines.some((line) => /^Radiator -/i.test(line.description)), false, "Relocating an existing radiator must not add a new radiator");
  assert.equal(estimate.materialLines.some((line) => /valve set/i.test(line.description)), false, "Existing valves are not replaced unless the scope says so");
  assert.ok(estimate.materialLines.some((line) => /compatible brackets and fixings/i.test(line.description)));
  const labour = estimate.labourLines.find((line) => line.sourceId === "pipe-heating-flow");
  assert.ok(labour);
  assert.equal(labour.hours, 3.3);
  assert.equal(labour.costRate, 40);
  assert.equal(labour.sellRate, 70);
  assert.ok(estimate.labourLines.some((line) => /relocate.*existing radiator/i.test(line.description) && line.hours === 3.5));
});
