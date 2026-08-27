import test from "node:test";
import assert from "node:assert/strict";

import { aylaSurveyQuoteCapabilities } from "./ayla-survey-quote-capabilities";

test("Ayla exposes survey and room-based quote capabilities", () => {
  const names = aylaSurveyQuoteCapabilities.map((capability) => capability.definition.name);
  assert.deepEqual(names, [
    "start_survey",
    "read_survey",
    "set_survey_room",
    "add_survey_scope",
    "review_survey",
    "build_survey_estimate",
    "build_room_quote",
  ]);
  const roomQuote = aylaSurveyQuoteCapabilities.find((capability) => capability.definition.name === "build_room_quote");
  assert.equal(roomQuote?.definition.requiresConfirmation, false);
  assert.match(roomQuote?.definition.description || "", /one client-facing cost centre per room\/work area/i);
});
