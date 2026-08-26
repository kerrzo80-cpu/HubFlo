/**
 * Per-drawing concurrent merge for Takeoff Studio.
 * Two people can mark different sheets on the same project; saves keep both.
 * Same drawing edited by both: last-write-wins for that drawing only.
 */

import type { TakeoffDocument } from "@/lib/takeoff-data";
import type {
  StudioAiReviewMeasuredQuantity,
  StudioClassification,
  StudioCustomLayer,
  StudioGeometry,
  StudioPageScale,
  StudioState,
} from "@/lib/takeoff-studio";

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function aiTagFingerprintForDocument(
  rows: StudioAiReviewMeasuredQuantity[] | undefined,
  documentId: string,
): string {
  if (!rows?.length) return "";
  const slices = rows
    .map((row) => {
      const tags = (row.tagMatches || []).filter((match) => match.documentId === documentId);
      const sheets = (row.sourceSheetIds || []).filter((id) => id === documentId);
      if (!tags.length && !sheets.length) return null;
      return { id: row.id, tags, sheets };
    })
    .filter(Boolean);
  return stableStringify(slices);
}

/** Fingerprint markups/scales/AI pins that belong to one drawing. */
export function studioDrawingMarkupFingerprint(
  studio: Pick<StudioState, "geometries" | "scales" | "aiReviewMeasured"> | null | undefined,
  documentId: string,
): string {
  if (!studio || !documentId) return "";
  const geometries = (studio.geometries || []).filter((geo) => geo.documentId === documentId);
  const scales = (studio.scales || []).filter((row) => row.documentId === documentId);
  return stableStringify({
    geometries,
    scales,
    ai: aiTagFingerprintForDocument(studio.aiReviewMeasured, documentId),
  });
}

export function studioDocumentIdsMentioned(
  studio: Pick<StudioState, "geometries" | "scales" | "aiReviewMeasured"> | null | undefined,
): string[] {
  if (!studio) return [];
  const ids = new Set<string>();
  for (const geo of studio.geometries || []) {
    if (geo.documentId) ids.add(geo.documentId);
  }
  for (const row of studio.scales || []) {
    if (row.documentId) ids.add(row.documentId);
  }
  for (const measured of studio.aiReviewMeasured || []) {
    for (const match of measured.tagMatches || []) {
      if (match.documentId) ids.add(match.documentId);
    }
    for (const sheetId of measured.sourceSheetIds || []) {
      if (sheetId) ids.add(sheetId);
    }
  }
  return [...ids];
}

/**
 * Drawings whose geometries / scales / AI pins changed since the last successful sync.
 * Empty array means shared studio fields only (classes, layers, tool) — do not wipe any sheet.
 */
export function documentIdsTouchedSinceBase(
  base: StudioState | null | undefined,
  next: StudioState,
): string[] {
  const ids = new Set<string>([
    ...studioDocumentIdsMentioned(base),
    ...studioDocumentIdsMentioned(next),
  ]);
  const touched: string[] = [];
  for (const documentId of ids) {
    if (studioDrawingMarkupFingerprint(base, documentId) !== studioDrawingMarkupFingerprint(next, documentId)) {
      touched.push(documentId);
    }
  }
  return touched.sort();
}

function mergeClassifications(
  server: StudioClassification[],
  incoming: StudioClassification[],
): StudioClassification[] {
  const byId = new Map<string, StudioClassification>();
  for (const row of server) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()];
}

function mergeCustomLayers(
  server: StudioCustomLayer[] | undefined,
  incoming: StudioCustomLayer[] | undefined,
): StudioCustomLayer[] | undefined {
  if (!server?.length && !incoming?.length) return incoming ?? server;
  const byId = new Map<string, StudioCustomLayer>();
  for (const row of server || []) byId.set(row.id, row);
  for (const row of incoming || []) byId.set(row.id, row);
  return [...byId.values()];
}

function mergeAiReviewMeasured(
  server: StudioAiReviewMeasuredQuantity[] | undefined,
  incoming: StudioAiReviewMeasuredQuantity[] | undefined,
  /** Drawings whose AI pins come from `incoming` (LWW). */
  incomingOwns: Set<string>,
): StudioAiReviewMeasuredQuantity[] | undefined {
  if (!server?.length && !incoming?.length) return incoming ?? server;

  type Tag = NonNullable<StudioAiReviewMeasuredQuantity["tagMatches"]>[number];
  const byId = new Map<string, StudioAiReviewMeasuredQuantity>();

  const ensure = (row: StudioAiReviewMeasuredQuantity) => {
    const existing = byId.get(row.id);
    if (existing) return existing;
    const created: StudioAiReviewMeasuredQuantity = {
      ...row,
      tagMatches: [],
      sourceSheetIds: [],
    };
    byId.set(row.id, created);
    return created;
  };

  for (const row of server || []) {
    const target = ensure(row);
    Object.assign(target, { ...row, tagMatches: target.tagMatches, sourceSheetIds: target.sourceSheetIds });
    for (const tag of row.tagMatches || []) {
      if (!incomingOwns.has(tag.documentId)) {
        (target.tagMatches as Tag[]).push(tag);
      }
    }
    for (const sheetId of row.sourceSheetIds || []) {
      if (!incomingOwns.has(sheetId)) {
        (target.sourceSheetIds as string[]).push(sheetId);
      }
    }
  }

  for (const row of incoming || []) {
    const target = ensure(row);
    Object.assign(target, {
      ...target,
      ...row,
      tagMatches: target.tagMatches,
      sourceSheetIds: target.sourceSheetIds,
    });
    for (const tag of row.tagMatches || []) {
      if (incomingOwns.has(tag.documentId)) {
        (target.tagMatches as Tag[]).push(tag);
      }
    }
    for (const sheetId of row.sourceSheetIds || []) {
      if (incomingOwns.has(sheetId)) {
        (target.sourceSheetIds as string[]).push(sheetId);
      }
    }
  }

  const merged = [...byId.values()].map((row) => {
    const tagById = new Map((row.tagMatches || []).map((tag) => [tag.id, tag]));
    const sheets = [...new Set(row.sourceSheetIds || [])];
    return {
      ...row,
      tagMatches: [...tagById.values()],
      sourceSheetIds: sheets,
    };
  });

  return merged.length ? merged : undefined;
}

function partitionByDocument<T extends { documentId: string }>(
  rows: T[],
  touched: Set<string>,
  fromIncoming: boolean,
): T[] {
  return rows.filter((row) => (fromIncoming ? touched.has(row.documentId) : !touched.has(row.documentId)));
}

export type ConcurrentStudioMergeResult = {
  studio: StudioState;
  /** Drawings whose markups were kept from the server (other user). */
  adoptedFromServer: string[];
  /** Drawings written from the saving client (LWW for those sheets). */
  overwrittenDocumentIds: string[];
  didMerge: boolean;
};

/**
 * Merge an incoming studio save into the current server studio.
 * `touchedDocumentIds` = drawings this client actually changed since last sync.
 */
export function mergeStudioStatesConcurrent(args: {
  server: StudioState;
  incoming: StudioState;
  touchedDocumentIds: string[];
}): ConcurrentStudioMergeResult {
  const touched = new Set(args.touchedDocumentIds.filter(Boolean));
  const serverDocIds = new Set(studioDocumentIdsMentioned(args.server));
  const adoptedFromServer = [...serverDocIds].filter((id) => !touched.has(id)).sort();
  const overwrittenDocumentIds = [...touched].sort();

  const geometries: StudioGeometry[] = [
    ...partitionByDocument(args.server.geometries || [], touched, false),
    ...partitionByDocument(args.incoming.geometries || [], touched, true),
  ];

  const scales: StudioPageScale[] = [
    ...partitionByDocument(args.server.scales || [], touched, false),
    ...partitionByDocument(args.incoming.scales || [], touched, true),
  ];

  const studio: StudioState = {
    ...args.server,
    ...args.incoming,
    version: 1,
    classifications: mergeClassifications(args.server.classifications || [], args.incoming.classifications || []),
    customLayers: mergeCustomLayers(args.server.customLayers, args.incoming.customLayers),
    geometries,
    scales,
    aiReviewMeasured: mergeAiReviewMeasured(args.server.aiReviewMeasured, args.incoming.aiReviewMeasured, touched),
    // Prefer saver's canvas focus / tool; keep server AI status if incoming omitted.
    activeDocumentId: args.incoming.activeDocumentId ?? args.server.activeDocumentId,
    activePage: args.incoming.activePage ?? args.server.activePage,
    activeClassificationId: args.incoming.activeClassificationId ?? args.server.activeClassificationId,
    activeLayerId: args.incoming.activeLayerId ?? args.server.activeLayerId,
    activePipeSpecId: args.incoming.activePipeSpecId ?? args.server.activePipeSpecId,
    tool: args.incoming.tool ?? args.server.tool,
    aiReviewStatus: args.incoming.aiReviewStatus ?? args.server.aiReviewStatus,
    aiReviewUpdatedAt: args.incoming.aiReviewUpdatedAt ?? args.server.aiReviewUpdatedAt,
    updatedAt: args.incoming.updatedAt || new Date().toISOString(),
  };

  return {
    studio,
    adoptedFromServer,
    overwrittenDocumentIds,
    didMerge: true,
  };
}

/** Union drawings/files by id — never drop the other user's uploaded sheets. */
export function mergeTakeoffDocumentsUnion(
  server: TakeoffDocument[],
  incoming: TakeoffDocument[],
): TakeoffDocument[] {
  const byId = new Map<string, TakeoffDocument>();
  for (const doc of server) byId.set(doc.id, doc);
  for (const doc of incoming) {
    const previous = byId.get(doc.id);
    byId.set(doc.id, previous ? { ...previous, ...doc, notes: doc.notes?.length ? doc.notes : previous.notes } : doc);
  }
  // Preserve server order, then append new incoming docs.
  const ordered: TakeoffDocument[] = [];
  const seen = new Set<string>();
  for (const doc of server) {
    const next = byId.get(doc.id);
    if (next) {
      ordered.push(next);
      seen.add(doc.id);
    }
  }
  for (const doc of incoming) {
    if (seen.has(doc.id)) continue;
    const next = byId.get(doc.id);
    if (next) {
      ordered.push(next);
      seen.add(doc.id);
    }
  }
  return ordered;
}

/**
 * After a save (or merge), pull other users' markups for drawings we are not editing,
 * without replacing the user's current drawing work.
 */
export function softRefreshStudioFromServer(args: {
  local: StudioState;
  server: StudioState;
  protectDocumentIds: string[];
}): { studio: StudioState; refreshedDocumentIds: string[] } {
  const protect = new Set(args.protectDocumentIds.filter(Boolean));
  if (args.local.activeDocumentId) protect.add(args.local.activeDocumentId);

  const refreshedDocumentIds: string[] = [];
  const serverIds = studioDocumentIdsMentioned(args.server);
  for (const documentId of serverIds) {
    if (protect.has(documentId)) continue;
    if (
      studioDrawingMarkupFingerprint(args.local, documentId)
      !== studioDrawingMarkupFingerprint(args.server, documentId)
    ) {
      refreshedDocumentIds.push(documentId);
    }
  }

  if (!refreshedDocumentIds.length) {
    // Still union classifications / custom layers / docs focus from server carefully.
    const classifications = mergeClassifications(args.local.classifications || [], args.server.classifications || []);
    const customLayers = mergeCustomLayers(args.local.customLayers, args.server.customLayers);
    if (
      stableStringify(classifications) === stableStringify(args.local.classifications)
      && stableStringify(customLayers || []) === stableStringify(args.local.customLayers || [])
    ) {
      return { studio: args.local, refreshedDocumentIds: [] };
    }
    return {
      studio: {
        ...args.local,
        classifications,
        customLayers,
        updatedAt: args.server.updatedAt || args.local.updatedAt,
      },
      refreshedDocumentIds: [],
    };
  }

  const refreshSet = new Set(refreshedDocumentIds);
  const geometries: StudioGeometry[] = [
    ...(args.local.geometries || []).filter((geo) => !refreshSet.has(geo.documentId)),
    ...(args.server.geometries || []).filter((geo) => refreshSet.has(geo.documentId)),
  ];
  const scales: StudioPageScale[] = [
    ...(args.local.scales || []).filter((row) => !refreshSet.has(row.documentId)),
    ...(args.server.scales || []).filter((row) => refreshSet.has(row.documentId)),
  ];

  return {
    studio: {
      ...args.local,
      classifications: mergeClassifications(args.local.classifications || [], args.server.classifications || []),
      customLayers: mergeCustomLayers(args.local.customLayers, args.server.customLayers),
      geometries,
      scales,
      aiReviewMeasured: mergeAiReviewMeasured(args.local.aiReviewMeasured, args.server.aiReviewMeasured, refreshSet),
      updatedAt: args.server.updatedAt || args.local.updatedAt,
    },
    refreshedDocumentIds: refreshedDocumentIds.sort(),
  };
}

export type TakeoffConcurrentMergeMeta = {
  adoptedFromServer: string[];
  overwrittenDocumentIds: string[];
};
