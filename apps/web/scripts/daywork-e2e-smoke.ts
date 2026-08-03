import { saveDayworkSheetToHub, listDayworkSheetsForJob, ensureDayworkVariationCostCentre } from "@/lib/engineer-flow";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { findDayworkSheetForJob } from "@/lib/daywork-sheets-store";
import { readServerStoreSnapshot, getServerStoreBackend } from "@/lib/server-store";

console.log("backend", getServerStoreBackend());
const jobId = "job-gas-cert-trial";
const costCentreId = ensureDayworkVariationCostCentre(jobId);
console.log("costCentreId", costCentreId);

saveDayworkSheetToHub({
  jobId,
  jobRef: "J-TRIAL-GAS",
  costCentreId,
  engineerName: "Chris Lawson",
  record: {
    description: "Emergency leak repair on rising main",
    weekEnding: "03/08/2026",
    labourName: "Chris Lawson",
    labourTrade: "Plumber",
    labourDaysJson: JSON.stringify([{ day: "Mon", hours: "8" }]),
    labourHours: "8",
    materialsJson: JSON.stringify([
      { description: "15mm copper pipe", qty: "3" },
      { description: "Isolation valve", qty: "2" },
    ]),
    plantJson: JSON.stringify([{ description: "Pipe freezer", qty: "1" }]),
    plumberSignature: "data:image/png;base64,iVBORw0KGgo=",
    clientSignature: "data:image/png;base64,iVBORw0KGgo=",
    plumberSignerName: "Chris Lawson",
    clientSignerName: "Jane Client",
    completedAt: new Date().toISOString(),
    populatedFrom: "engineer-app",
  },
});

const sheets1 = listDayworkSheetsForJob(jobId);
console.log("afterField", {
  n: sheets1.length,
  mats: sheets1[0]?.materialsJson?.slice(0, 100),
  client: sheets1[0]?.clientSignerName,
  sigs: !!(sheets1[0]?.plumberSignature && sheets1[0]?.clientSignature),
});

const current = getHubDetailState();
saveHubDetailState({
  ...current,
  dayworkSheets: {},
  flowStepEvidence: {},
  jobDeliveryEvents: [],
});

const after = getHubDetailState();
const found = findDayworkSheetForJob((after.dayworkSheets || {}) as any, jobId, costCentreId);
console.log("afterWipe", {
  keys: Object.keys(after.dayworkSheets || {}),
  mats: found?.materialsJson?.slice(0, 100),
  client: found?.clientSignerName,
  sigs: !!(found?.plumberSignature && found?.clientSignature),
});
console.log("disk", {
  dedicated: Object.keys((readServerStoreSnapshot("daywork-sheets-store") as object) || {}),
  hubSheets: Object.keys(((readServerStoreSnapshot("hub-detail-store") as any)?.dayworkSheets) || {}),
});

if (!found?.materialsJson?.includes("copper") || found.clientSignerName !== "Jane Client") {
  console.error("FAIL same-process");
  process.exit(1);
}
console.log("PASS same-process");
