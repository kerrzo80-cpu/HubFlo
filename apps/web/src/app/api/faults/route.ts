import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders, type HubRole } from "@/lib/access";
import {
  addFaultComment,
  createFaultIssue,
  deleteFaultIssue,
  faultDashboardStats,
  getFaultIssue,
  listFaultIssues,
  listFaultModules,
  updateFaultIssue,
} from "@/lib/faults-data";
import { parseJsonRequestBody } from "@/lib/http";
import type { FaultPriority, FaultStatus, FaultType, FaultVisibility } from "@/lib/faults-types";

export const runtime = "nodejs";

function roleFromHeaders(headers: Headers): HubRole | null {
  const role = headers.get("x-hubflo-role")?.trim();
  if (
    role === "Owner/Admin" ||
    role === "Manager" ||
    role === "Office" ||
    role === "Engineer" ||
    role === "Finance" ||
    role === "Read-only"
  ) {
    return role;
  }
  return null;
}

function actorFromHeaders(headers: Headers, bodyName?: string) {
  return {
    id: headers.get("x-hubflo-employee-id")?.trim() || undefined,
    name: bodyName?.trim() || headers.get("x-hubflo-employee-name")?.trim() || "NeXa user",
  };
}

function canView(access: ReturnType<typeof getAccessProfileFromHeaders>, role: HubRole | null) {
  if (role === "Read-only") return true;
  return Boolean(access) || Boolean(role);
}

function canCreate(role: HubRole | null) {
  return role !== "Read-only";
}

function canTriage(access: ReturnType<typeof getAccessProfileFromHeaders>, role: HubRole | null) {
  return access.canCustomize || role === "Owner/Admin" || role === "Manager";
}

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  const role = roleFromHeaders(request.headers);
  if (!canView(access, role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  const reference = request.nextUrl.searchParams.get("reference")?.trim();
  if (id || reference) {
    const issue = getFaultIssue(id || reference || "");
    if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canTriage(access, role) && issue.reporterId && issue.reporterId !== actorFromHeaders(request.headers).id) {
      // Non-triage users may still open by reference if they know it in Phase 1 company workspace.
    }
    return NextResponse.json({ issue, modules: listFaultModules() });
  }

  const issues = listFaultIssues();
  return NextResponse.json({
    issues,
    modules: listFaultModules(),
    stats: faultDashboardStats(issues),
  });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  const role = roleFromHeaders(request.headers);

  const body = await parseJsonRequestBody<{
    action?: "create" | "update" | "set-status" | "comment" | "delete";
    id?: string;
    title?: string;
    description?: string;
    module?: string;
    type?: FaultType;
    priority?: FaultPriority;
    status?: FaultStatus;
    assignedToId?: string | null;
    assignedToName?: string | null;
    developmentNotes?: string;
    testingNotes?: string;
    aiDescription?: string;
    sourcePage?: string;
    sourceRoute?: string;
    sourceCompanyId?: string;
    sourceCompanyName?: string;
    visibility?: FaultVisibility;
    comment?: string;
    commentKind?: "comment" | "development" | "testing";
    actorName?: string;
    patch?: Record<string, unknown>;
  }>(request);

  const actor = actorFromHeaders(request.headers, body?.actorName);
  const action = body?.action || "create";

  try {
    if (action === "create") {
      if (!canCreate(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.description?.trim()) {
        return NextResponse.json({ error: "description required" }, { status: 400 });
      }
      const issue = createFaultIssue({
        title: body.title,
        description: body.description,
        module: body.module,
        type: body.type,
        priority: body.priority,
        status: canTriage(access, role) ? body.status : "inbox",
        reporterId: actor.id,
        reporterName: actor.name,
        assignedToId: canTriage(access, role) ? body.assignedToId || undefined : undefined,
        assignedToName: canTriage(access, role) ? body.assignedToName || undefined : undefined,
        sourcePage: body.sourcePage,
        sourceRoute: body.sourceRoute,
        sourceCompanyId: body.sourceCompanyId,
        sourceCompanyName: body.sourceCompanyName,
        visibility: body.visibility,
        developmentNotes: canTriage(access, role) ? body.developmentNotes : undefined,
        testingNotes: canTriage(access, role) ? body.testingNotes : undefined,
      });
      return NextResponse.json({ issue, issues: listFaultIssues(), stats: faultDashboardStats() });
    }

    if (action === "update" || action === "set-status") {
      if (!canTriage(access, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const patch = {
        ...(body.patch || {}),
        title: body.title,
        originalDescription: body.description,
        aiDescription: body.aiDescription,
        module: body.module,
        type: body.type,
        priority: body.priority,
        status: body.status,
        assignedToId: body.assignedToId,
        assignedToName: body.assignedToName,
        developmentNotes: body.developmentNotes,
        testingNotes: body.testingNotes,
        sourcePage: body.sourcePage,
        sourceRoute: body.sourceRoute,
        visibility: body.visibility,
      };
      const issue = updateFaultIssue(body.id, patch, actor);
      return NextResponse.json({ issue, issues: listFaultIssues(), stats: faultDashboardStats() });
    }

    if (action === "comment") {
      if (!canCreate(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.id || !body.comment?.trim()) {
        return NextResponse.json({ error: "id and comment required" }, { status: 400 });
      }
      const kind = body.commentKind === "development" || body.commentKind === "testing" ? body.commentKind : "comment";
      if ((kind === "development" || kind === "testing") && !canTriage(access, role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const issue = addFaultComment(body.id, body.comment, actor, kind);
      return NextResponse.json({ issue, issues: listFaultIssues(), stats: faultDashboardStats() });
    }

    if (action === "delete") {
      if (!canTriage(access, role) || role !== "Owner/Admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const result = deleteFaultIssue(body.id, actor);
      return NextResponse.json({ ...result, issues: listFaultIssues(), stats: faultDashboardStats() });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Faults request failed" },
      { status: 400 },
    );
  }
}
