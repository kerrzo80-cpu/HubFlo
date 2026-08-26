import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultStudioState } from "@/lib/takeoff-studio";
import { shouldRestoreTakeoffStudioLocalDraft } from "@/lib/takeoff-studio-local-draft";

describe("takeoff studio local draft", () => {
  it("restores when server markups look wiped vs a richer recent draft", () => {
    const draft = {
      projectId: "p1",
      savedAt: new Date().toISOString(),
      geometryCount: 1,
      scaleCount: 1,
      studio: {
        ...createDefaultStudioState(),
        geometries: [
          {
            id: "g1",
            classificationId: "c",
            kind: "count" as const,
            documentId: "d1",
            page: 1,
            point: { x: 0, y: 0 },
          },
        ],
        scales: [{ documentId: "d1", page: 1, metresPerUnit: 0.1 }],
      },
    };
    assert.equal(
      shouldRestoreTakeoffStudioLocalDraft(createDefaultStudioState(), draft),
      true,
    );
    assert.equal(
      shouldRestoreTakeoffStudioLocalDraft(draft.studio, draft),
      false,
    );
  });
});
