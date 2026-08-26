import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import { getHubDetailState, saveHubDetailState, purgeDayworkSheetFromHub } from "@/lib/hub-detail-store";
import { dayworkSheetKey } from "@/lib/daywork-account-form";
import { discardUnsignedDayworkSheet, removeDayworkSheet } from "@/lib/engineer-flow";
import {
  deleteVariationPortalByEventId,
  upsertVariationPortalRequest,
  getVariationPortalRequestsByVariationEvent,
} from "@/lib/variation-portal-data";

describe("daywork and variation delete", () => {
  beforeEach(() => {
    for (const jobId of ["job-delete-test", "job-signed-delete"]) {
      purgeDayworkSheetFromHub({ jobId, costCentreId: `${jobId}-daywork-account` });
    }
  });

  it("removes an unsigned daywork sheet and linked variation event", () => {
    const jobId = "job-delete-test";
    const costCentreId = `${jobId}-daywork-account`;
    const key = dayworkSheetKey(jobId, costCentreId);
    const hub = getHubDetailState();
    saveHubDetailState({
      ...hub,
      dayworkSheets: {
        [key]: {
          jobId,
          jobRef: "J-100",
          costCentreId,
          updatedAt: new Date().toISOString(),
          description: "Extra works",
          labourName: "Chris",
          weekEnding: "2026-08-20",
          labourHours: "4",
          materialsJson: "[]",
          plumberSignature: "",
          clientSignature: "",
          populatedFrom: "core",
        },
      },
      jobDeliveryEvents: [
        {
          id: `daywork-${jobId}-${costCentreId}`,
          jobId,
          jobRef: "J-100",
          kind: "variation",
          actor: "Chris",
          summary: "Daywork account",
          createdAt: new Date().toISOString(),
          source: "NeXa",
        },
      ],
    });

    const result = discardUnsignedDayworkSheet({ jobId, costCentreId });
    assert.equal(result.discarded, true);

    const next = getHubDetailState() as {
      dayworkSheets?: Record<string, unknown>;
      jobDeliveryEvents?: Array<{ id?: string }>;
    };
    assert.equal(Boolean(next.dayworkSheets?.[key]), false);
    assert.equal(
      (next.jobDeliveryEvents || []).some((event) => event.id === `daywork-${jobId}-${costCentreId}`),
      false,
    );
  });

  it("blocks Field discard of signed dayworks but allows office force delete", () => {
    const jobId = "job-signed-delete";
    const costCentreId = `${jobId}-daywork-account`;
    const key = dayworkSheetKey(jobId, costCentreId);
    const hub = getHubDetailState();
    saveHubDetailState({
      ...hub,
      dayworkSheets: {
        [key]: {
          jobId,
          jobRef: "J-101",
          costCentreId,
          updatedAt: new Date().toISOString(),
          description: "Signed works",
          labourName: "Chris",
          weekEnding: "2026-08-20",
          labourHours: "3",
          materialsJson: "[]",
          plumberSignature: "data:image/png;base64,aaa",
          clientSignature: "data:image/png;base64,bbb",
          plumberSignerName: "Chris",
          clientSignerName: "Client",
          populatedFrom: "engineer-app",
        },
      },
      jobDeliveryEvents: [
        {
          id: `daywork-${jobId}-${costCentreId}`,
          jobId,
          jobRef: "J-101",
          kind: "variation",
          actor: "Chris",
          summary: "Daywork account",
          createdAt: new Date().toISOString(),
          source: "NeXa",
          costCentreId,
        },
      ],
    });

    const blocked = discardUnsignedDayworkSheet({ jobId, costCentreId });
    assert.equal(blocked.discarded, false);
    assert.match(String(blocked.reason || ""), /cannot be discarded/i);

    const forced = removeDayworkSheet({ jobId, costCentreId, allowSubmitted: true });
    assert.equal(forced.discarded, true);

    const next = getHubDetailState() as {
      dayworkSheets?: Record<string, unknown>;
      jobDeliveryEvents?: Array<{ id?: string }>;
    };
    assert.equal(Boolean(next.dayworkSheets?.[key]), false);
    assert.equal(
      (next.jobDeliveryEvents || []).some((event) => event.id === `daywork-${jobId}-${costCentreId}`),
      false,
    );
  });

  it("deletes variation portal requests by event id", () => {
    const created = upsertVariationPortalRequest({
      variationEventId: "var-event-1",
      jobId: "job-1",
      jobRef: "J-1",
      summary: "Extra pipework",
      description: "Extra pipework on site",
      costValue: 100,
      sellValue: 180,
      actor: "Office",
    });
    assert.ok(created.token);
    assert.ok(getVariationPortalRequestsByVariationEvent("var-event-1"));

    const removed = deleteVariationPortalByEventId("var-event-1");
    assert.equal(removed, 1);
    assert.equal(getVariationPortalRequestsByVariationEvent("var-event-1"), null);
  });
});
