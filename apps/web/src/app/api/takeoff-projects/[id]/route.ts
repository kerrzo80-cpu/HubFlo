import { NextRequest, NextResponse } from "next/server";

import { canSaveTakeoff, employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import {
  deleteTakeoffProject,
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffDocument,
  type TakeoffProject,
} from "@/lib/takeoff-data";
import {
  mergeStudioStatesConcurrent,
  mergeTakeoffDocumentsUnion,
  type TakeoffConcurrentMergeMeta,
} from "@/lib/takeoff-studio-concurrent-merge";
import { takeoffStudioSaveConflicts } from "@/lib/takeoff-studio-save-conflict";
import type { StudioState } from "@/lib/takeoff-studio";
import {
  getTender,
  linkTakeoffToTender,
  clearTenderSourcedDrawingsFromTakeoff,
  restoreTenderSourcedDrawingsToTakeoff,
  copyTenderDrawingsToTakeoff,
} from "@/lib/tenders-data";

type TakeoffPatchBody = Partial<TakeoffProject> & {
  expectedUpdatedAt?: string;
  /** Drawings this client changed since last sync — drives per-drawing merge. */
  touchedDocumentIds?: string[];
};

const TAKEOFF_SAVE_FORBIDDEN =
  "Your login cannot save Takeoffs (needs quote-create or job-edit permission). Ask an office admin, or sign in with an Office account.";

function withConcurrentMergeMeta(
  project: TakeoffProject,
  meta: TakeoffConcurrentMergeMeta | undefined,
) {
  if (!meta) return project;
  return { ...project, concurrentMerge: meta };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canSaveTakeoff(access)) {
    return NextResponse.json({ error: TAKEOFF_SAVE_FORBIDDEN, code: "forbidden" }, { status: 403 });
  }

  try {
    const body = await parseJsonRequestBody<TakeoffPatchBody>(request);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body — save payload may be too large or corrupted." },
        { status: 400 },
      );
    }

    const { id } = await params;
    const previous = getTakeoffProject(id);

    // Stale project token: merge per-drawing instead of whole-blob last-write-wins.
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;
    const stale = takeoffStudioSaveConflicts(previous?.updatedAt, expectedUpdatedAt);
    let concurrentMergeMeta: TakeoffConcurrentMergeMeta | undefined;

    const patch: Partial<TakeoffProject> = { ...body };
    delete (patch as { expectedUpdatedAt?: string }).expectedUpdatedAt;
    delete (patch as { touchedDocumentIds?: string[] }).touchedDocumentIds;
    // Never accept client-supplied tender stash blobs on studio saves (bloat / clobber risk).
    delete (patch as { studioTenderArchives?: unknown }).studioTenderArchives;

    if (stale) {
      const incomingStudio = body.studio;
      const canMergeStudio = Boolean(previous && incomingStudio && typeof incomingStudio === "object");
      if (!canMergeStudio) {
        return NextResponse.json(
          {
            error:
              "Someone else saved this takeoff. Reload to see their changes, then continue — your marks are still in this browser's autosave.",
            code: "conflict",
            serverUpdatedAt: previous?.updatedAt,
          },
          { status: 409 },
        );
      }

      const touchedRaw = body.touchedDocumentIds;
      const touchedDocumentIds = Array.isArray(touchedRaw)
        ? touchedRaw.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];

      const serverStudio = (previous!.studio || incomingStudio) as StudioState;
      const merged = mergeStudioStatesConcurrent({
        server: serverStudio,
        incoming: incomingStudio as StudioState,
        touchedDocumentIds,
      });
      patch.studio = merged.studio;
      concurrentMergeMeta = {
        adoptedFromServer: merged.adoptedFromServer,
        overwrittenDocumentIds: merged.overwrittenDocumentIds,
      };

      if (Array.isArray(body.documents)) {
        patch.documents = mergeTakeoffDocumentsUnion(
          previous!.documents || [],
          body.documents as TakeoffDocument[],
        );
      }
    }
    if (body.sourceTenderId !== undefined) {
      const tenderId = body.sourceTenderId || undefined;
      if (tenderId) {
        const tender = getTender(tenderId);
        if (!tender) {
          return NextResponse.json({ error: "Tender not found" }, { status: 400 });
        }
        patch.sourceTenderId = tender.id;
        patch.sourceTenderRef = tender.externalId || tender.name;
        if (!body.customer) patch.customer = tender.client;
        if (!body.site && tender.area) patch.site = tender.area;
        if (!body.clientId && tender.clientId) patch.clientId = tender.clientId;
      } else {
        patch.sourceTenderId = undefined;
        patch.sourceTenderRef = undefined;
      }
    }

    let updated = updateTakeoffProject(id, patch);
    if (!updated) {
      return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
    }

    if (body.sourceTenderId !== undefined) {
      try {
        linkTakeoffToTender(updated.id, updated.reference, updated.sourceTenderId || null);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Unable to link tender" },
          { status: 400 },
        );
      }

      const previousTenderId = previous?.sourceTenderId || undefined;
      const nextTenderId = updated.sourceTenderId || undefined;
      // Tender link change: stash previous tender sheets+markups (keep files), restore target archive, then sync any new drawings.
      if (previousTenderId !== nextTenderId) {
        const hadTenderSheets = (updated.documents || []).some((doc) =>
          Array.isArray(doc.notes) && doc.notes.some((note) => note.startsWith("sourceTenderDoc:")),
        );
        if (previousTenderId || hadTenderSheets) {
          const cleared = clearTenderSourcedDrawingsFromTakeoff(updated.id, {
            archiveTenderId: previousTenderId || "__unlinked__",
            archiveTenderRef: previous?.sourceTenderRef,
          });
          if (cleared.takeoff) {
            updated = cleared.takeoff;
          }
        }
        if (nextTenderId) {
          const restored = restoreTenderSourcedDrawingsToTakeoff(updated.id, nextTenderId);
          if (restored.takeoff) {
            updated = restored.takeoff;
          }
        }
      }

      if (nextTenderId) {
        const tender = getTender(nextTenderId);
        if (tender) {
          const synced = copyTenderDrawingsToTakeoff(tender, updated.id);
          if (synced.takeoff) {
            return NextResponse.json(withConcurrentMergeMeta(synced.takeoff, concurrentMergeMeta));
          }
        }
      } else if (previousTenderId !== nextTenderId) {
        return NextResponse.json(withConcurrentMergeMeta(updated, concurrentMergeMeta));
      }
    }

    const prevStatus = previous?.studio?.aiReviewStatus;
    const nextStatus = updated.studio?.aiReviewStatus;
    if (prevStatus !== nextStatus && (nextStatus === "confirmed" || nextStatus === "rejected")) {
      const actor = request.headers.get(employeeHeaderName) || "Office";
      try {
        appendAuditEvent({
          actor,
          action: nextStatus === "confirmed" ? "blake_confirm" : "blake_reject",
          recordType: "takeoff_project",
          recordId: id,
          summary:
            nextStatus === "confirmed"
              ? "Blake AI review confirmed — pins kept for Core"
              : "Blake AI review rejected — pins excluded from Core",
          source: "takeoff add-on",
          importance: "high",
        });
      } catch {
        // ignore
      }
    }

    return NextResponse.json(withConcurrentMergeMeta(updated, concurrentMergeMeta));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Takeoff save failed on the server.";
    return NextResponse.json(
      {
        error: message.includes("disk") || message.includes("store") || message.includes("SQLite")
          ? message
          : `Takeoff save failed on the server: ${message}`,
        code: "persist_failed",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canSaveTakeoff(access)) {
    return NextResponse.json({ error: TAKEOFF_SAVE_FORBIDDEN }, { status: 403 });
  }

  const { id } = await params;
  const deleted = deleteTakeoffProject(id);
  if (!deleted) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted });
}
