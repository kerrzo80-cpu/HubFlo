import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const baseUrl = process.env.NEXA_BASE_URL || "http://127.0.0.1:3000";
const tenantId = `acceptance-${Date.now()}`;
const headers = {
  "Content-Type": "application/json",
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Acceptance tester",
  "x-hubflo-tenant-id": tenantId,
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const questions = [
  ["water-supply-stopcock", "Existing conditions"],
  ["drainage-waste-routes", "Existing conditions"],
  ["electrical-supply", "Existing conditions"],
  ["heating-drain-down", "Existing conditions"],
  ["access-construction", "Access and construction"],
  ["parking-restrictions", "Access and construction"],
  ["asbestos-safety", "Safety"],
  ["builders-work", "Access and construction"],
  ["existing-boiler", "Boiler"],
  ["gas-meter-supply", "Gas"],
  ["proposed-boiler-position", "Boiler"],
  ["flue-route", "Flue"],
  ["condensate-route", "Boiler"],
  ["controls", "Controls"],
];
const now = new Date().toISOString();
const photos = ["Existing condition", "Proposed position", "Pipe route", "Boiler data plate", "Gas meter"].map((category, index) => ({
  id: `photo-${index}`,
  category,
  fileName: `${category}.jpg`,
  mimeType: "image/jpeg",
  size: 100,
  storageKey: `acceptance/photo-${index}.jpg`,
  caption: category,
  capturedAt: now,
  surveySection: "Boiler relocation",
}));

const createBody = {
  clientMutationId: `atag-${tenantId}`,
  customerName: "ATAG acceptance customer",
  siteAddress: "1 Acceptance Street, Aberdeen",
  primaryContact: { name: "Site contact", email: "site@example.com", phone: "01224 000000" },
  jobLink: { type: "Quote", id: "quote-atag", reference: "Q-ATAG" },
  surveyorName: "Brian Kerr",
  surveyDate: "2026-07-16",
  customerRequirements: "Relocate an existing ATAG boiler into a kitchen cupboard.",
  occupancy: "Occupied",
  market: "Domestic",
  jobType: "Boiler relocation",
  answers: questions.map(([key, section], index) => ({
    id: `answer-${index}`,
    key,
    section,
    question: key,
    value: "Confirmed on site",
    status: "Confirmed",
    notes: "",
    photoIds: [],
    updatedAt: now,
  })),
  rooms: [{ id: "room-kitchen", name: "Kitchen", lengthM: 4.2, widthM: 3.1, heightM: 2.4, wallConstruction: "Masonry", floorConstruction: "Suspended timber", ceilingConstruction: "Plasterboard", accessNotes: "Cupboard and roof access recorded", photoIds: [] }],
  scopeItems: [{ id: "scope-relocate", taskType: "Relocate existing ATAG boiler", trade: "Plumbing/Heating", roomOrArea: "Kitchen", existingPosition: "Utility", proposedPosition: "Kitchen cupboard", quantity: 1, dimensions: "Recorded", status: "Confirmed", responsibility: "EWG", notes: "Alter hot, cold, heating, condensate and controls", photoIds: [] }],
  pipeRuns: [{ id: "pipe-gas", service: "Gas", fromLocation: "Gas meter", toLocation: "Kitchen cupboard", measuredLengthM: 12, pipeSize: "22mm subject to sizing", material: "Copper", route: "Measured route", insulationRequired: false, directionChanges: [{ type: "Bend", quantity: 6 }], accessDifficulty: "Restricted", fireStopping: false, coreDrilling: true, makingGood: true, measurementStatus: "Measured", notes: "Sizing design check", photoIds: [] }],
  equipmentItems: [{ id: "equipment-flue", category: "Flue", roomOrArea: "Kitchen / roof", description: "Vertical terminal, four extensions, four 45-degree bends and roof weathering", make: "ATAG", model: "TBC", supplierCode: "", quantity: 1, dimensions: "TBC", outputOrCapacity: "", connectionRequirements: "Manufacturer compatibility", rfqRequired: true, status: "TBC", tbcReason: "Exact boiler model and compatible flue parts require supplier confirmation", notes: "", photoIds: [] }],
  photos,
  workByOthers: ["Decoration beyond local making good"],
  assumptions: ["Existing boiler can be relocated subject to manufacturer confirmation"],
};

const forbidden = await request("/api/surveys", {
  method: "POST",
  headers: { "x-hubflo-role": "Read-only" },
  body: JSON.stringify(createBody),
});
assert.equal(forbidden.response.status, 403, "Read-only users must not create surveys");

const created = await request("/api/surveys", { method: "POST", body: JSON.stringify(createBody) });
assert.equal(created.response.status, 201);
assert.equal(created.body.version, 1);
assert.equal(created.body.pipeRuns[0].measuredLengthM, 12);

const retry = await request("/api/surveys", { method: "POST", body: JSON.stringify(createBody) });
assert.equal(retry.body.id, created.body.id, "Create retries must be idempotent");

const patched = await request(`/api/surveys/${created.body.id}`, {
  method: "PATCH",
  body: JSON.stringify({ expectedVersion: 1, patch: { customerRequirements: `${createBody.customerRequirements} Access confirmed.` } }),
});
assert.equal(patched.response.status, 200);
assert.equal(patched.body.version, 2);

const stale = await request(`/api/surveys/${created.body.id}`, {
  method: "PATCH",
  body: JSON.stringify({ expectedVersion: 1, patch: { customerRequirements: "Stale overwrite" } }),
});
assert.equal(stale.response.status, 409, "Stale autosave must be rejected");
assert.equal(stale.body.current.version, 2);

const review = await request(`/api/surveys/${created.body.id}/completion-review`);
assert.equal(review.response.status, 200);
assert.equal(review.body.canComplete, true);
assert.ok(review.body.supplierRfqs.some((item) => item.recordId === "equipment-flue"));

const completed = await request(`/api/surveys/${created.body.id}/complete`, {
  method: "POST",
  body: JSON.stringify({ expectedVersion: 2 }),
});
assert.equal(completed.response.status, 200);
assert.equal(completed.body.survey.status, "Complete");

const sent = await request(`/api/surveys/${created.body.id}/send-to-estimator`, {
  method: "POST",
  body: JSON.stringify({ expectedVersion: completed.body.survey.version }),
});
assert.equal(sent.response.status, 200);
assert.equal(sent.body.survey.status, "Sent to estimator");
assert.equal(sent.body.estimate.sourceSurveyVersion, completed.body.survey.version);
assert.equal(sent.body.estimate.pricingProfile.id, "domestic-small-works");
assert.ok(sent.body.estimate.materialLines.length > 0, "Estimator must generate itemised material components");
assert.ok(sent.body.estimate.labourLines.length > 0, "Estimator must generate labour tasks");
const gasPipe = sent.body.estimate.materialLines.find((line) => line.sourceId === "pipe-gas" && line.unit === "m");
assert.equal(gasPipe?.quantity, 13.2, "12m measured gas run must include the configured 10% waste");
assert.match(gasPipe?.calculationExplanation || "", /Measured 12m \+ 10% waste/);
assert.equal(sent.body.estimate.materialLines.find((line) => /vertical flue terminal/i.test(line.description))?.quantity, 1);
assert.equal(sent.body.estimate.materialLines.find((line) => /vertical flue extension/i.test(line.description))?.quantity, 4);
assert.equal(sent.body.estimate.materialLines.find((line) => /45-degree flue bend/i.test(line.description))?.quantity, 4);
assert.equal(sent.body.estimate.materialLines.find((line) => /roof weathering/i.test(line.description))?.quantity, 1);
assert.ok(sent.body.estimate.materialLines.every((line) => !/\bkit\b/i.test(line.description)), "Generic hidden kits must not be generated");
assert.ok(sent.body.estimate.labourLines.some((line) => line.labourType === "Plumber"));
assert.ok(sent.body.estimate.labourLines.some((line) => line.labourType === "Joiner"));
assert.ok(sent.body.estimate.labourLines.some((line) => line.labourType === "Electrician"));

const estimate = await request(`/api/estimates/${sent.body.estimate.id}`);
assert.equal(estimate.response.status, 200);
assert.equal(estimate.body.surveyId, created.body.id);

const pdfResponse = await fetch(`${baseUrl}/api/surveys/${created.body.id}/pdf`, { headers });
assert.equal(pdfResponse.status, 200);
assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
assert.equal(pdfBytes.subarray(0, 4).toString(), "%PDF");
assert.ok(pdfBytes.length > 5000, "Branded survey PDF should contain substantive survey content");
if (process.env.NEXA_ACCEPTANCE_PDF) {
  const output = path.resolve(process.env.NEXA_ACCEPTANCE_PDF);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, pdfBytes);
}

const regenerated = await request(`/api/estimates/${sent.body.estimate.id}/regenerate`, {
  method: "POST",
  body: JSON.stringify({ expectedVersion: estimate.body.version }),
});
assert.equal(regenerated.response.status, 200);
assert.equal(regenerated.body.materialLines.length, estimate.body.materialLines.length);
assert.equal(new Set(regenerated.body.materialLines.map((line) => line.id)).size, regenerated.body.materialLines.length);
assert.equal(regenerated.body.generationRuns.length, 2);

const editableGasPipe = regenerated.body.materialLines.find((line) => line.sourceId === "pipe-gas" && line.unit === "m");
const corrected = await request(`/api/estimates/${sent.body.estimate.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    expectedVersion: regenerated.body.version,
    lineType: "Material",
    lineId: editableGasPipe.id,
    patch: { unitCost: 3.25, supplier: "Acceptance supplier" },
    correctionReason: "Acceptance test supplier price",
  }),
});
assert.equal(corrected.response.status, 200);
assert.equal(corrected.body.materialLines.find((line) => line.id === editableGasPipe.id)?.unitCost, 3.25);
assert.equal(corrected.body.corrections.at(-1)?.reason, "Acceptance test supplier price");

const repriced = await request(`/api/estimates/${sent.body.estimate.id}/pricing`, {
  method: "PATCH",
  body: JSON.stringify({
    expectedVersion: corrected.body.version,
    patch: { name: "Acceptance pricing", labourSellRate: 72, materialMarkupPercent: 31, plantMarkupPercent: 20, vatPercent: 20 },
    correctionReason: "Acceptance test estimate-specific pricing",
  }),
});
assert.equal(repriced.response.status, 200);
assert.equal(repriced.body.pricingProfile.labourSellRate, 72);
assert.equal(repriced.body.pricingProfile.materialMarkupPercent, 31);
assert.ok(repriced.body.labourLines.some((line) => line.sellRate === 72));
assert.ok(repriced.body.materialLines.some((line) => line.markupPercent === 31));

const rfqResponse = await fetch(`${baseUrl}/api/estimates/${sent.body.estimate.id}/supplier-rfq`, { headers });
assert.equal(rfqResponse.status, 200);
const rfqCsv = await rfqResponse.text();
assert.match(rfqCsv, /vertical flue terminal/i);
assert.match(rfqCsv, /vertical flue extension/i);
assert.doesNotMatch(rfqCsv, /Heating system cleaner/i, "RFQ export must contain only lines explicitly marked Supplier RFQ");

const simproPayload = await request(`/api/estimates/${sent.body.estimate.id}/simpro-payload`);
assert.equal(simproPayload.response.status, 200);
assert.ok(simproPayload.body.costCentres.some((centre) => centre.name === "Heating" && centre.simproId === 5));
assert.ok(simproPayload.body.costCentres.some((centre) => centre.name === "Joinery" && centre.simproId === 7));
assert.ok(simproPayload.body.costCentres.some((centre) => centre.name === "Electrical" && centre.simproId === 11));

const pushed = await request(`/api/estimates/${sent.body.estimate.id}/push-to-quote`, {
  method: "POST",
  body: JSON.stringify({ expectedVersion: repriced.body.version }),
});
assert.equal(pushed.response.status, 200);
assert.equal(pushed.body.estimate.status, "Pushed");
assert.ok(pushed.body.quote.ref.startsWith("Q-"));
assert.ok(pushed.body.costCentres.some((centre) => centre.name === "Heating"));
assert.ok(pushed.body.costCentres.some((centre) => centre.name === "Joinery"));
assert.ok(pushed.body.costCentres.some((centre) => centre.name === "Electrical"));
const heatingCentre = pushed.body.costCentres.find((centre) => centre.name === "Heating");
assert.equal(heatingCentre.lines.find((line) => line.id === editableGasPipe.id)?.unitCost, 3.25);

console.log(JSON.stringify({
  ok: true,
  survey: sent.body.survey.reference,
  estimate: sent.body.estimate.reference,
  review: {
    blockers: review.body.blockers.length,
    rfqs: review.body.supplierRfqs.length,
    designDependencies: review.body.designDependencies.length,
    materials: repriced.body.materialLines.length,
    labourTasks: repriced.body.labourLines.length,
    corrections: repriced.body.corrections.length,
    pdfBytes: pdfBytes.length,
    coreQuote: pushed.body.quote.ref,
    costCentres: pushed.body.costCentres.length,
  },
}, null, 2));
