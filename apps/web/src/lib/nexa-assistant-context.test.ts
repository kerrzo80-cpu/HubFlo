import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  humaniseBookingLabel,
  resolveJobIdentityFollowUp,
} from "@/lib/nexa-assistant-context";

const jobs = [
  {
    ref: "J-1007",
    customer: "Example Customer",
    site: "17 Hillside Drive, Aberdeen",
    description: "General Plumbing",
  },
];

describe("Blake job context follow-ups", () => {
  it("resolves an explicit job reference to customer and site details", () => {
    const reply = resolveJobIdentityFollowUp(
      "I need to know the customer name, not J-1007. I don't know what job that means.",
      [],
      jobs,
    );

    assert.equal(
      reply,
      "J-1007 is for Example Customer at 17 Hillside Drive, Aberdeen. The work is General Plumbing.",
    );
  });

  it("uses the most recent job reference from conversation history", () => {
    const reply = resolveJobIdentityFollowUp(
      "What's the customer name for that job?",
      [
        {
          role: "assistant",
          text: "Murray is booked on J-1007 · General Plumbing from 08:00 to 16:00.",
        },
      ],
      jobs,
    );

    assert.match(reply ?? "", /Example Customer/);
    assert.match(reply ?? "", /17 Hillside Drive/);
  });

  it("does not hijack unrelated conversation", () => {
    assert.equal(
      resolveJobIdentityFollowUp("What is Murray doing next Tuesday?", [], jobs),
      null,
    );
  });

  it("shows customer and site before the internal job reference in diary labels", () => {
    assert.equal(
      humaniseBookingLabel("J-1007 · General Plumbing", jobs),
      "Example Customer · 17 Hillside Drive, Aberdeen · General Plumbing · (J-1007)",
    );
  });
});
