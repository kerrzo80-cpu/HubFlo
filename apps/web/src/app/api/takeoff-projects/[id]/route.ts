import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import {
  deleteTakeoffProject,
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffProject,
} from "@/lib/takeoff-data";
import {
  getTender,
  linkTakeoffToTender,
  clearTenderSourcedDrawingsFromTakeoff,
  restoreTenderSourcedDrawingsToTakeoff,
  copyTenderDrawingsToTakeoff,
} from "@/lib/tenders-data";

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
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<Partial<TakeoffProject>>(request);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = await params;
  const previous = getTakeoffProject(id);

  const patch: Partial<TakeoffProject> = { ...body };
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
          return NextResponse.json(synced.takeoff);
        }
      }
    } else if (previousTenderId !== nextTenderId) {
      return NextResponse.json(updated);
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

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const deleted = deleteTakeoffProject(id);
  if (!deleted) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted });
}
