import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders, type HubRole } from "@/lib/access";
import { classifyFaultReport, generateFaultDevelopmentBrief } from "@/lib/faults-ai";
import {
  addFaultComment,
  buildDevelopmentTaskMarkdown,
  createCustomerFeedbackRequest,
  createFaultIssue,
  deleteFaultIssue,
  faultDashboardStats,
  getFaultIssue,
  listCustomerFeedbackRequests,
  listFaultIssues,
  listFaultModules,
  promoteCustomerFeedbackToIssue,
  recordFaultTestResult,
  updateFaultIssue,
} from "@/lib/faults-data";
import { githubFaultsConfigured, syncFaultIssueToGithub } from "@/lib/faults-github";
import { parseJsonRequestBody } from "@/lib/http";
import type {
  CustomerFeedbackStatus,
  FaultPriority,
  FaultStatus,
  FaultType,
  FaultVisibility,
} from "@/lib/faults-types";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    id: headers.get("x-hubflo-employee-id")?.trim() || headers.get("x-nexa-auth-user-id")?.trim() || undefined,
    name:
      bodyName?.trim() ||
      headers.get("x-nexa-auth-user-name")?.trim() ||
      headers.get("x-hubflo-employee-name")?.trim() ||
      "NeXa user",
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
  const view = request.nextUrl.searchParams.get("view")?.trim();

  if (view === "customer-requests") {
    if (!canTriage(access, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({
      requests: listCustomerFeedbackRequests(),
      githubConfigured: githubFaultsConfigured(),
    });
  }

  if (id || reference) {
    const issue = getFaultIssue(id || reference || "");
    if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      issue,
      modules: listFaultModules(),
      githubConfigured: githubFaultsConfigured(),
      developmentTaskMarkdown: buildDevelopmentTaskMarkdown(issue),
    });
  }

  const issues = listFaultIssues();
  return NextResponse.json({
    issues,
    modules: listFaultModules(),
    stats: faultDashboardStats(issues),
    customerRequests: canTriage(access, role) ? listCustomerFeedbackRequests() : [],
    githubConfigured: githubFaultsConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  const role = roleFromHeaders(request.headers);

  const body = await parseJsonRequestBody<{
    action?:
      | "create"
      | "update"
      | "set-status"
      | "comment"
      | "delete"
      | "classify"
      | "generate-brief"
      | "test-result"
      | "customer-feedback"
      | "promote-feedback"
      | "send-to-development"
      | "sync-github";
    id?: string;
    requestId?: string;
    linkToIssueId?: string;
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
    companyName?: string;
    visibility?: FaultVisibility;
    customerStatus?: CustomerFeedbackStatus;
    comment?: string;
    commentKind?: "comment" | "development" | "testing";
    actorName?: string;
    classifyWithAi?: boolean;
    testResult?: "pass" | "fail";
    testNote?: string;
    buildVersion?: string;
    briefMarkdown?: string;
    patch?: Record<string, unknown>;
  }>(request);

  const actor = actorFromHeaders(request.headers, body?.actorName);
  const action = body?.action || "create";

  try {
    if (action === "classify") {
      if (!canCreate(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.description?.trim()) return NextResponse.json({ error: "description required" }, { status: 400 });
      const classified = await classifyFaultReport({
        description: body.description,
        sourceRoute: body.sourceRoute,
        sourcePage: body.sourcePage,
      });
      return NextResponse.json({ classified });
    }

    if (action === "create") {
      if (!canCreate(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.description?.trim()) {
        return NextResponse.json({ error: "description required" }, { status: 400 });
      }
      let title = body.title;
      let moduleName = body.module;
      let type = body.type;
      let priority = body.priority;
      let aiDescription = body.aiDescription;
      if (body.classifyWithAi) {
        const classified = await classifyFaultReport({
          description: body.description,
          sourceRoute: body.sourceRoute,
          sourcePage: body.sourcePage,
        });
        title = title || classified.title;
        moduleName = moduleName || classified.module;
        type = type || classified.type;
        priority = priority || classified.priority;
        aiDescription = aiDescription || classified.aiDescription;
      }
      const issue = createFaultIssue({
        title,
        description: body.description,
        module: moduleName,
        type,
        priority,
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
        aiDescription,
      });
      return NextResponse.json({ issue, issues: listFaultIssues(), stats: faultDashboardStats() });
    }

    if (action === "customer-feedback") {
      if (!canCreate(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.description?.trim()) return NextResponse.json({ error: "description required" }, { status: 400 });
      const requestRow = createCustomerFeedbackRequest({
        companyId: body.sourceCompanyId,
        companyName: body.companyName || body.sourceCompanyName || "Company",
        title: body.title,
        description: body.description,
        module: body.module,
        type: body.type,
        reporterId: actor.id,
        reporterName: actor.name,
        sourcePage: body.sourcePage,
        sourceRoute: body.sourceRoute,
      });
      return NextResponse.json({ request: requestRow, requests: listCustomerFeedbackRequests() });
    }

    if (action === "promote-feedback") {
      if (!canTriage(access, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });
      const result = promoteCustomerFeedbackToIssue(body.requestId, actor, {
        linkToIssueId: body.linkToIssueId,
      });
      return NextResponse.json({
        ...result,
        issues: listFaultIssues(),
        requests: listCustomerFeedbackRequests(),
        stats: faultDashboardStats(),
      });
    }

    if (action === "update" || action === "set-status") {
      if (!canTriage(access, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const issue = updateFaultIssue(
        body.id,
        {
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
          customerStatus: body.customerStatus,
          buildVersion: body.buildVersion,
        },
        actor,
      );
      return NextResponse.json({ issue, issues: listFaultIssues(), stats: faultDashboardStats() });
    }

    if (action === "generate-brief") {
      if (!canTriage(access, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const current = getFaultIssue(body.id);
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const brief = await generateFaultDevelopmentBrief(current, actor.name);
      if (body.briefMarkdown?.trim()) brief.editableMarkdown = body.briefMarkdown.trim();
      const issue = updateFaultIssue(body.id, { developmentBrief: brief, aiDescription: brief.issueSummary }, actor);
      return NextResponse.json({ issue, brief, issues: listFaultIssues(), stats: faultDashboardStats() });
    }

    if (action === "test-result") {
      if (!canTriage(access, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.id || (body.testResult !== "pass" && body.testResult !== "fail")) {
        return NextResponse.json({ error: "id and testResult required" }, { status: 400 });
      }
      const issue = recordFaultTestResult(
        body.id,
        { result: body.testResult, note: body.testNote, buildVersion: body.buildVersion },
        actor,
      );
      return NextResponse.json({ issue, issues: listFaultIssues(), stats: faultDashboardStats() });
    }

    if (action === "send-to-development") {
      if (!canTriage(access, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      let current = getFaultIssue(body.id);
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!current.developmentBrief) {
        const brief = await generateFaultDevelopmentBrief(current, actor.name);
        current = updateFaultIssue(body.id, { developmentBrief: brief }, actor);
      }
      const markdown = buildDevelopmentTaskMarkdown(current);
      const issue = updateFaultIssue(
        body.id,
        {
          developmentTaskMarkdown: markdown,
          status: current.status === "approved" || current.status === "inbox" ? "ready_for_development" : current.status,
        },
        actor,
      );
      return NextResponse.json({
        issue,
        developmentTaskMarkdown: markdown,
        issues: listFaultIssues(),
        stats: faultDashboardStats(),
      });
    }

    if (action === "sync-github") {
      if (!canTriage(access, role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const current = getFaultIssue(body.id);
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const sync = await syncFaultIssueToGithub(current);
      if (!sync.ok) {
        const issue = updateFaultIssue(
          body.id,
          { github: { ...current.github, lastError: sync.error, syncedAt: new Date().toISOString() } },
          actor,
        );
        return NextResponse.json({ error: sync.error, issue }, { status: 400 });
      }
      const issue = updateFaultIssue(
        body.id,
        {
          github: {
            issueNumber: sync.issueNumber,
            issueUrl: sync.issueUrl,
            syncedAt: new Date().toISOString(),
            lastError: undefined,
          },
        },
        actor,
      );
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
