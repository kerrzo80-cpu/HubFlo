/**
 * Per-tender stash for Takeoff Studio drawings + markups.
 * Switching Linked tender hides/swaps sheets but must not permanently wipe work.
 */

import type { TakeoffDocument, TakeoffProject } from "@/lib/takeoff-data";
import { takeoffSourceTenderDocId } from "@/lib/takeoff-drawing-labels";
import {
  purgeStudioDocuments,
  type StudioAiReviewMeasuredQuantity,
  type StudioGeometry,
  type StudioPageScale,
  type StudioState,
} from "@/lib/takeoff-studio";

export type TakeoffTenderStudioArchive = {
  tenderId: string;
  tenderRef?: string;
  archivedAt: string;
  documents: TakeoffDocument[];
  geometries: StudioGeometry[];
  scales: StudioPageScale[];
  aiReviewMeasured?: StudioAiReviewMeasuredQuantity[];
  activeDocumentId?: string;
  activePage?: number;
};

function isDrawingLike(doc: TakeoffDocument) {
  return (
    doc.kind === "Drawing"
    || doc.kind === "Marked-up drawing"
    || (doc.mimeType || "").includes("pdf")
  );
}

function sliceAiReviewForDocuments(
  rows: StudioAiReviewMeasuredQuantity[] | undefined,
  documentIds: Set<string>,
): StudioAiReviewMeasuredQuantity[] | undefined {
  if (!rows) return undefined;
  return rows
    .map((row) => ({
      ...row,
      tagMatches: (row.tagMatches || []).filter((match) => documentIds.has(match.documentId)),
      sourceSheetIds: row.sourceSheetIds?.filter((id) => documentIds.has(id)),
    }))
    .filter(
      (row) =>
        (row.tagMatches && row.tagMatches.length > 0)
        || (row.sourceSheetIds && row.sourceSheetIds.length > 0),
    );
}

/** Build a stash snapshot for tender-synced sheets currently on the project. */
export function buildTenderStudioArchive(
  project: Pick<TakeoffProject, "documents" | "studio">,
  tenderId: string,
  tenderRef?: string,
  archivedAt = new Date().toISOString(),
): TakeoffTenderStudioArchive | null {
  const documents = (project.documents || []).filter((doc) => takeoffSourceTenderDocId(doc.notes));
  if (!documents.length) return null;

  const documentIds = new Set(documents.map((doc) => doc.id));
  const studio = project.studio;
  const geometries = (studio?.geometries || []).filter((geo) => documentIds.has(geo.documentId));
  const scales = (studio?.scales || []).filter((row) => documentIds.has(row.documentId));
  const aiReviewMeasured = sliceAiReviewForDocuments(studio?.aiReviewMeasured, documentIds);

  return {
    tenderId,
    tenderRef,
    archivedAt,
    documents,
    geometries,
    scales,
    ...(aiReviewMeasured?.length ? { aiReviewMeasured } : {}),
    activeDocumentId:
      studio?.activeDocumentId && documentIds.has(studio.activeDocumentId)
        ? studio.activeDocumentId
        : documents[0]?.id,
    activePage: studio?.activePage || 1,
  };
}

/**
 * Move tender-synced drawings + their markups into studioTenderArchives[tenderId].
 * Keeps PDF files on disk (storageKey unchanged). Local uploads stay active.
 */
export function stashTenderSourcedDrawings(
  project: TakeoffProject,
  tenderId: string,
  tenderRef?: string,
): TakeoffProject {
  const archiveKey = tenderId || "__unlinked__";
  const archive = buildTenderStudioArchive(project, archiveKey, tenderRef);
  if (!archive || !archive.documents.length) {
    return project;
  }

  const removedIds = new Set(archive.documents.map((doc) => doc.id));
  const keepDocs = project.documents.filter((doc) => !removedIds.has(doc.id));
  const fallbackActive = keepDocs.find(isDrawingLike)?.id;

  const studio = project.studio
    ? purgeStudioDocuments(project.studio, removedIds, fallbackActive)
    : undefined;

  const archives = { ...(project.studioTenderArchives || {}) };
  // Never replace a richer markup stash with a poorer one (accidental empty re-stash).
  const previous = archives[archiveKey];
  const previousMarkupCount = (previous?.geometries?.length || 0) + (previous?.scales?.length || 0);
  const nextMarkupCount = archive.geometries.length + archive.scales.length;
  if (
    !previous
    || nextMarkupCount > previousMarkupCount
    || (
      nextMarkupCount === previousMarkupCount
      && archive.documents.length >= (previous.documents?.length || 0)
    )
  ) {
    archives[archiveKey] = archive;
  }

  return {
    ...project,
    documents: keepDocs,
    ...(studio ? { studio } : {}),
    studioTenderArchives: archives,
  };
}

/**
 * Restore a previously stashed tender's drawings + markups onto the project.
 * Document ids / storageKeys are preserved so geometries still line up.
 */
export function restoreTenderStudioArchive(
  project: TakeoffProject,
  tenderId: string,
): { project: TakeoffProject; restored: boolean; documentCount: number; markupCount: number } {
  const archive = project.studioTenderArchives?.[tenderId];
  if (!archive?.documents?.length) {
    return { project, restored: false, documentCount: 0, markupCount: 0 };
  }

  const existingIds = new Set(project.documents.map((doc) => doc.id));
  const existingSourceIds = new Set(
    project.documents.map((doc) => takeoffSourceTenderDocId(doc.notes)).filter(Boolean),
  );

  const toAdd: TakeoffDocument[] = [];
  for (const doc of archive.documents) {
    if (existingIds.has(doc.id)) continue;
    const sourceId = takeoffSourceTenderDocId(doc.notes);
    if (sourceId && existingSourceIds.has(sourceId)) continue;
    toAdd.push(doc);
    existingIds.add(doc.id);
    if (sourceId) existingSourceIds.add(sourceId);
  }

  const restoredDocIds = new Set(archive.documents.map((doc) => doc.id));
  const baseStudio = project.studio;
  let studio: StudioState | undefined = baseStudio;
  if (baseStudio) {
    const geometryIds = new Set(baseStudio.geometries.map((g) => g.id));
    const geometries = [
      ...baseStudio.geometries,
      ...archive.geometries.filter((geo) => !geometryIds.has(geo.id)),
    ];
    const scaleKeys = new Set(baseStudio.scales.map((row) => `${row.documentId}:${row.page}`));
    const scales = [
      ...baseStudio.scales,
      ...archive.scales.filter((row) => !scaleKeys.has(`${row.documentId}:${row.page}`)),
    ];
    const aiExisting = baseStudio.aiReviewMeasured || [];
    const aiIds = new Set(aiExisting.map((row) => row.id));
    const aiReviewMeasured = archive.aiReviewMeasured?.length
      ? [...aiExisting, ...archive.aiReviewMeasured.filter((row) => !aiIds.has(row.id))]
      : baseStudio.aiReviewMeasured;

    const preferredActive =
      (archive.activeDocumentId && restoredDocIds.has(archive.activeDocumentId)
        ? archive.activeDocumentId
        : undefined)
      || toAdd[0]?.id
      || archive.documents[0]?.id
      || baseStudio.activeDocumentId;

    studio = {
      ...baseStudio,
      geometries,
      scales,
      aiReviewMeasured,
      activeDocumentId: preferredActive,
      activePage: archive.activePage || baseStudio.activePage || 1,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    project: {
      ...project,
      documents: [...toAdd, ...project.documents],
      ...(studio ? { studio } : {}),
      studioTenderArchives: project.studioTenderArchives,
    },
    restored: true,
    documentCount: toAdd.length || archive.documents.length,
    markupCount: archive.geometries.length + archive.scales.length,
  };
}

/** Count markups that sit on tender-synced sheets (used for switch warnings). */
export function countMarkupsOnTenderDocuments(
  studio: StudioState | undefined,
  documents: TakeoffDocument[],
): number {
  const tenderDocIds = new Set(
    documents.filter((doc) => takeoffSourceTenderDocId(doc.notes)).map((doc) => doc.id),
  );
  if (!tenderDocIds.size || !studio) return 0;
  const geos = studio.geometries.filter((geo) => tenderDocIds.has(geo.documentId)).length;
  const scales = studio.scales.filter((row) => tenderDocIds.has(row.documentId)).length;
  return geos + scales;
}
