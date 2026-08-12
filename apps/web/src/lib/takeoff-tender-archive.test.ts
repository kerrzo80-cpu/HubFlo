import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultStudioState } from "@/lib/takeoff-studio";
import {
  countMarkupsOnTenderDocuments,
  restoreTenderStudioArchive,
  stashTenderSourcedDrawings,
} from "@/lib/takeoff-tender-archive";
import type { TakeoffDocument, TakeoffProject } from "@/lib/takeoff-data";

function doc(id: string, sourceTenderDocId?: string, fileName = `${id}.pdf`): TakeoffDocument {
  return {
    id,
    kind: "Drawing",
    fileName,
    uploadedAt: "2026-08-12T10:00:00.000Z",
    status: "Uploaded",
    notes: sourceTenderDocId
      ? [`sourceTenderDoc:${sourceTenderDocId}`, "Copied from tender drawings on Send to Takeoff."]
      : ["Local upload"],
    storageKey: `takeoff-files/proj/${id}.pdf`,
  };
}

function project(partial: Partial<TakeoffProject> & { documents: TakeoffDocument[] }): TakeoffProject {
  return {
    id: "takeoff-1",
    reference: "TK-1",
    name: "Test",
    customer: "Client",
    site: "Site",
    description: "",
    status: "In review",
    rooms: [],
    measurements: [],
    pipeRuns: [],
    radiators: [],
    materialAllowances: [],
    labourAllowances: [],
    supplierRequests: [],
    review: {
      officeNotes: "",
      riskFlags: [],
    },
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    ...partial,
  };
}

describe("takeoff tender studio archive", () => {
  it("stashes markups when leaving tender A and restores them when returning A → B → A", () => {
    const docA = doc("doc-a", "tender-doc-a", "queens.pdf");
    const local = doc("doc-local");
    const studio = {
      ...createDefaultStudioState(),
      activeDocumentId: "doc-a",
      activePage: 2,
      geometries: [
        {
          id: "g-pipe",
          classificationId: "cls-1",
          kind: "linear" as const,
          documentId: "doc-a",
          page: 1,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
        {
          id: "g-local",
          classificationId: "cls-1",
          kind: "count" as const,
          documentId: "doc-local",
          page: 1,
          point: { x: 1, y: 1 },
        },
      ],
      scales: [
        { documentId: "doc-a", page: 1, metresPerUnit: 0.01 },
        { documentId: "doc-local", page: 1, metresPerUnit: 0.02 },
      ],
    };

    const onA = project({
      sourceTenderId: "tender-a",
      sourceTenderRef: "3 Queens Terrace",
      documents: [docA, local],
      studio,
    });

    assert.equal(countMarkupsOnTenderDocuments(studio, onA.documents), 2);

    const afterLeaveA = stashTenderSourcedDrawings(onA, "tender-a", "3 Queens Terrace");
    assert.equal(afterLeaveA.documents.length, 1);
    assert.equal(afterLeaveA.documents[0]?.id, "doc-local");
    assert.equal(afterLeaveA.studio?.geometries.length, 1);
    assert.equal(afterLeaveA.studio?.geometries[0]?.id, "g-local");
    assert.equal(afterLeaveA.studioTenderArchives?.["tender-a"]?.geometries.length, 1);
    assert.equal(afterLeaveA.studioTenderArchives?.["tender-a"]?.documents[0]?.storageKey, docA.storageKey);

    const docB = doc("doc-b", "tender-doc-b", "other.pdf");
    const onB = project({
      ...afterLeaveA,
      sourceTenderId: "tender-b",
      documents: [docB, ...afterLeaveA.documents],
      studio: {
        ...afterLeaveA.studio!,
        activeDocumentId: "doc-b",
        geometries: [
          ...(afterLeaveA.studio?.geometries || []),
          {
            id: "g-b",
            classificationId: "cls-1",
            kind: "count" as const,
            documentId: "doc-b",
            page: 1,
            point: { x: 5, y: 5 },
          },
        ],
      },
      studioTenderArchives: afterLeaveA.studioTenderArchives,
    });

    const afterLeaveB = stashTenderSourcedDrawings(onB, "tender-b", "Other tender");
    assert.ok(afterLeaveB.studioTenderArchives?.["tender-b"]);
    assert.equal(afterLeaveB.documents.map((d) => d.id).join(","), "doc-local");

    const restored = restoreTenderStudioArchive(afterLeaveB, "tender-a");
    assert.equal(restored.restored, true);
    assert.ok(restored.project.documents.some((d) => d.id === "doc-a"));
    assert.ok(restored.project.documents.some((d) => d.id === "doc-local"));
    assert.ok(!restored.project.documents.some((d) => d.id === "doc-b"));
    const pipe = restored.project.studio?.geometries.find((g) => g.id === "g-pipe");
    assert.ok(pipe);
    assert.equal(pipe?.documentId, "doc-a");
    assert.ok(restored.project.studio?.scales.some((row) => row.documentId === "doc-a"));
    assert.equal(restored.project.studio?.activeDocumentId, "doc-a");
    // Local markup still present
    assert.ok(restored.project.studio?.geometries.some((g) => g.id === "g-local"));
  });

  it("does not drop a richer archive when a later empty stash is poorer", () => {
    const docA = doc("doc-a", "src-a");
    const rich = project({
      documents: [docA],
      studio: {
        ...createDefaultStudioState(),
        geometries: [
          {
            id: "g1",
            classificationId: "cls",
            kind: "count" as const,
            documentId: "doc-a",
            page: 1,
            point: { x: 0, y: 0 },
          },
        ],
        scales: [{ documentId: "doc-a", page: 1, metresPerUnit: 0.1 }],
      },
    });
    const withArchive = stashTenderSourcedDrawings(rich, "tender-a");
    assert.equal(withArchive.studioTenderArchives?.["tender-a"]?.geometries.length, 1);

    // Simulate empty re-stash of same key with no markups (should keep richer)
    const emptyAgain = stashTenderSourcedDrawings(
      {
        ...withArchive,
        documents: [docA],
        studio: createDefaultStudioState(),
      },
      "tender-a",
    );
    assert.equal(emptyAgain.studioTenderArchives?.["tender-a"]?.geometries.length, 1);
  });
});
