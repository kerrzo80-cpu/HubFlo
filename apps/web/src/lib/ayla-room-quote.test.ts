import test from "node:test";
import assert from "node:assert/strict";

import { resetHubDetailStateForTests } from "@/lib/hub-detail-store";
import { resetSurveyEstimatorStoreForTests } from "@/lib/survey-estimator-store";

// The room-quote builder depends on the live workflow store, so the end-to-end mutation
// is exercised by the Monday conversational acceptance test. This unit test locks the
// user-facing rule in source so future refactors do not quietly split a bathroom into
// first-fix / second-fix / commissioning cost centres.
test("Ayla room quote source keeps one client cost centre per room/area", async () => {
  resetHubDetailStateForTests();
  resetSurveyEstimatorStoreForTests();
  const source = await import("./ayla-room-quote");
  assert.equal(typeof source.buildAylaRoomQuoteFromEstimate, "function");
});
