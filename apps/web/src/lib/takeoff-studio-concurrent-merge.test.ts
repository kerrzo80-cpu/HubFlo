import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  documentIdsTouchedSinceBase,
  mergeStudioStatesConcurrent,
  mergeTakeoffDocumentsUnion,
  softRefreshStudioFromServer,
  studioDrawingMarkupFingerprint,
} from "@/lib/takeoff-studio-concurrent-merge";
import { createDefaultStudioState, type StudioState } from "@/lib/takeoff-studio";
import type { TakeoffDocument } from "@/lib/takeoff-data";

function baseStudio(overrides: Partial<StudioState> = {}): StudioState {
  return {
    ...createDefaultStudioState(),
    ...overrides,
  };
}

describe("documentIdsTouchedSinceBase", () => {
  it("detects only drawings whose markups changed", () => {
    const base = baseStudio({
      geometries: [
        {
          id: "g1",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-1",
          page: 1,
          point: { x: 1, y: 1 },
        },
      ],
      scales: [{ documentId: "drawing-2", page: 1, metresPerUnit: 0.05 }],
    });
    const next = baseStudio({
      geometries: [
        {
          id: "g1",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-1",
          page: 1,
          point: { x: 1, y: 1 },
        },
        {
          id: "g2",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-2",
          page: 1,
          point: { x: 2, y: 2 },
        },
      ],
      scales: [{ documentId: "drawing-2", page: 1, metresPerUnit: 0.05 }],
    });
    assert.deepEqual(documentIdsTouchedSinceBase(base, next), ["drawing-2"]);
  });

  it("treats clearing a drawing as a touch", () => {
    const base = baseStudio({
      geometries: [
        {
          id: "g1",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-1",
          page: 1,
          point: { x: 1, y: 1 },
        },
      ],
    });
    const next = baseStudio({ geometries: [] });
    assert.deepEqual(documentIdsTouchedSinceBase(base, next), ["drawing-1"]);
  });
});

describe("mergeStudioStatesConcurrent", () => {
  it("keeps user A marks on drawing 1 and user B marks on drawing 2", () => {
    const server = baseStudio({
      geometries: [
        {
          id: "b1",
          classificationId: "hot",
          kind: "count",
          documentId: "drawing-2",
          page: 1,
          point: { x: 9, y: 9 },
        },
      ],
      scales: [{ documentId: "drawing-2", page: 1, metresPerUnit: 0.04 }],
      classifications: [
        { id: "hot", kind: "count", name: "Tap", colour: "#1998cf", unit: "nr", layer: "hot-cold" },
      ],
    });
    const incoming = baseStudio({
      geometries: [
        {
          id: "a1",
          classificationId: "heat",
          kind: "linear",
          documentId: "drawing-1",
          page: 1,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
      scales: [{ documentId: "drawing-1", page: 1, metresPerUnit: 0.05 }],
      classifications: [
        { id: "heat", kind: "linear", name: "22mm Cu", colour: "#c45c26", unit: "m", layer: "heating" },
      ],
    });

    const merged = mergeStudioStatesConcurrent({
      server,
      incoming,
      touchedDocumentIds: ["drawing-1"],
    });

    assert.equal(merged.studio.geometries.length, 2);
    assert.ok(merged.studio.geometries.some((geo) => geo.id === "a1"));
    assert.ok(merged.studio.geometries.some((geo) => geo.id === "b1"));
    assert.equal(merged.studio.scales.length, 2);
    assert.equal(merged.studio.classifications.length, 2);
    assert.deepEqual(merged.adoptedFromServer, ["drawing-2"]);
    assert.deepEqual(merged.overwrittenDocumentIds, ["drawing-1"]);
  });

  it("last-write-wins only for the contested drawing", () => {
    const server = baseStudio({
      geometries: [
        {
          id: "old",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-1",
          page: 1,
          point: { x: 1, y: 1 },
        },
        {
          id: "keep",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-2",
          page: 1,
          point: { x: 2, y: 2 },
        },
      ],
    });
    const incoming = baseStudio({
      geometries: [
        {
          id: "new",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-1",
          page: 1,
          point: { x: 5, y: 5 },
        },
      ],
    });

    const merged = mergeStudioStatesConcurrent({
      server,
      incoming,
      touchedDocumentIds: ["drawing-1"],
    });

    assert.deepEqual(
      merged.studio.geometries.map((geo) => geo.id).sort(),
      ["keep", "new"],
    );
  });

  it("does not wipe other drawings when touchedDocumentIds is empty", () => {
    const server = baseStudio({
      geometries: [
        {
          id: "b1",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-2",
          page: 1,
          point: { x: 1, y: 1 },
        },
      ],
    });
    const incoming = baseStudio({
      geometries: [],
      activeLayerId: "heating",
    });

    const merged = mergeStudioStatesConcurrent({
      server,
      incoming,
      touchedDocumentIds: [],
    });

    assert.equal(merged.studio.geometries.length, 1);
    assert.equal(merged.studio.geometries[0]?.id, "b1");
    assert.equal(merged.studio.activeLayerId, "heating");
  });
});

describe("mergeTakeoffDocumentsUnion", () => {
  it("unions drawings without dropping the other user's sheets", () => {
    const server: TakeoffDocument[] = [
      {
        id: "d1",
        kind: "Drawing",
        fileName: "heating.pdf",
        uploadedAt: "t1",
        status: "Uploaded",
        notes: [],
      },
    ];
    const incoming: TakeoffDocument[] = [
      {
        id: "d2",
        kind: "Drawing",
        fileName: "hot-cold.pdf",
        uploadedAt: "t2",
        status: "Uploaded",
        notes: [],
      },
    ];
    const merged = mergeTakeoffDocumentsUnion(server, incoming);
    assert.deepEqual(
      merged.map((doc) => doc.id),
      ["d1", "d2"],
    );
  });
});

describe("softRefreshStudioFromServer", () => {
  it("pulls other drawings from server without touching the protected drawing", () => {
    const local = baseStudio({
      activeDocumentId: "drawing-1",
      geometries: [
        {
          id: "local-1",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-1",
          page: 1,
          point: { x: 1, y: 1 },
        },
      ],
    });
    const server = baseStudio({
      geometries: [
        {
          id: "remote-2",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-2",
          page: 1,
          point: { x: 2, y: 2 },
        },
        {
          id: "stale-1",
          classificationId: "c1",
          kind: "count",
          documentId: "drawing-1",
          page: 1,
          point: { x: 9, y: 9 },
        },
      ],
    });

    const result = softRefreshStudioFromServer({
      local,
      server,
      protectDocumentIds: ["drawing-1"],
    });

    assert.deepEqual(result.refreshedDocumentIds, ["drawing-2"]);
    assert.ok(result.studio.geometries.some((geo) => geo.id === "local-1"));
    assert.ok(result.studio.geometries.some((geo) => geo.id === "remote-2"));
    assert.ok(!result.studio.geometries.some((geo) => geo.id === "stale-1"));
    assert.equal(studioDrawingMarkupFingerprint(result.studio, "drawing-1"), studioDrawingMarkupFingerprint(local, "drawing-1"));
  });
});
