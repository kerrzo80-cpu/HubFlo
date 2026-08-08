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
  const updated = updateTakeoffProject(id, body);
  if (!updated) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
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
