import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultStudioState, purgeStudioDocuments } from "@/lib/takeoff-studio";

describe("purgeStudioDocuments", () => {
  it("drops geometries, scales, and AI pins for removed drawings", () => {
    const base = createDefaultStudioState();
    const studio = {
      ...base,
      activeDocumentId: "doc-old",
      activePage: 3,
      geometries: [
        {
          id: "g1",
          classificationId: "cls-1",
          kind: "count" as const,
          documentId: "doc-old",
          page: 1,
          point: { x: 1, y: 2 },
        },
        {
          id: "g2",
          classificationId: "cls-1",
          kind: "count" as const,
          documentId: "doc-keep",
          page: 1,
          point: { x: 3, y: 4 },
        },
      ],
      scales: [
        { documentId: "doc-old", page: 1, metresPerUnit: 0.1 },
        { documentId: "doc-keep", page: 1, metresPerUnit: 0.05 },
      ],
      aiReviewMeasured: [
        {
          id: "ai-1",
          kind: "primary" as const,
          code: "WC",
          description: "WC",
          unit: "nr",
          tagMatches: [
            { id: "t1", documentId: "doc-old", pageNumber: 1, x: 0, y: 0 },
            { id: "t2", documentId: "doc-keep", pageNumber: 1, x: 1, y: 1 },
          ],
        },
      ],
    };

    const next = purgeStudioDocuments(studio, ["doc-old"], "doc-keep");
    assert.equal(next.geometries.length, 1);
    assert.equal(next.geometries[0]?.documentId, "doc-keep");
    assert.equal(next.scales.length, 1);
    assert.equal(next.scales[0]?.documentId, "doc-keep");
    assert.equal(next.aiReviewMeasured?.[0]?.tagMatches?.length, 1);
    assert.equal(next.aiReviewMeasured?.[0]?.tagMatches?.[0]?.documentId, "doc-keep");
    assert.equal(next.activeDocumentId, "doc-keep");
    assert.equal(next.activePage, 1);
  });

  it("keeps active document when it was not removed", () => {
    const studio = {
      ...createDefaultStudioState(),
      activeDocumentId: "doc-keep",
      activePage: 2,
      scales: [{ documentId: "doc-keep", page: 2, metresPerUnit: 0.02 }],
    };
    const next = purgeStudioDocuments(studio, ["doc-old"], "doc-other");
    assert.equal(next.activeDocumentId, "doc-keep");
    assert.equal(next.activePage, 2);
  });
});
