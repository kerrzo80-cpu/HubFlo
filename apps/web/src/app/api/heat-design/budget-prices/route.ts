import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { budgetPriceKitWithBlake, kitBudgetSummary } from "@/lib/blake-budget-prices";
import { calculateSystemDesign, type HeatDesignBlakeProposal } from "@/lib/heat-design";
import { getHeatDesignProject, saveHeatDesignProject } from "@/lib/heat-design-store";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
  /** Re-ask Blake even when library already filled costs. */
  forceRefresh?: boolean;
};

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json(
      { error: "Sign in with quote access to refresh Blake budget prices." },
      { status: 403 },
    );
  }

  const body = (await parseJsonRequestBody<Body>(request)) || {};
  const projectId = body.projectId?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = getHeatDesignProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Heat Design project not found" }, { status: 404 });
  }

  const design = calculateSystemDesign(project);
  const sourceLines =
    project.blakeProposal?.kitLines?.length
      ? project.blakeProposal.kitLines
      : design.kit.filter((line) => line.id.startsWith("kit-blake"));

  const priced = await budgetPriceKitWithBlake(sourceLines.length ? sourceLines : design.kit, {
    forceRefreshBudget: body.forceRefresh !== false,
    context: `${project.name} · ${project.chosenSystemId || "system"} · ${project.rooms.length} rooms`,
  });

  const blakeProposal: HeatDesignBlakeProposal = {
    at: new Date().toISOString(),
    summary: project.blakeProposal?.summary || "Blake budget prices refreshed.",
    narrative:
      priced.aiUsed
        ? "Live Blake filled UK trade budget unit costs. Amend each line when the supplier quote is uploaded."
        : project.blakeProposal?.narrative
          || "Budget prices from rate library (OpenAI offline or skipped).",
    kitLines: priced.lines,
    clarifyingQuestions: project.blakeProposal?.clarifyingQuestions || [],
    routeNotes: [
      ...(project.blakeProposal?.routeNotes || []),
      priced.aiUsed
        ? "Budget costs are not firm quotes — replace with supplier prices when RFQ returns."
        : "",
    ].filter(Boolean),
    aiUsed: Boolean(project.blakeProposal?.aiUsed || priced.aiUsed),
    connected: priced.connected,
    model: priced.model || project.blakeProposal?.model,
    error: priced.error,
  };

  const next = saveHeatDesignProject({
    ...project,
    blakeProposal,
    updatedAt: new Date().toISOString(),
  });

  const { actor } = surveyRequestContext(request);
  try {
    appendAuditEvent({
      actor,
      action: "heat_design.budget_prices",
      recordType: "heat_design_project",
      recordId: project.id,
      summary: priced.aiUsed
        ? `Blake budget prices · ${priced.pricedCount} lines · £${priced.budgetTotal}`
        : `Guide budget prices · ${priced.pricedCount} lines`,
      source: "heat-design",
      importance: "normal",
    });
  } catch {
    // non-blocking
  }

  return NextResponse.json({
    ok: true,
    ...priced,
    summary: kitBudgetSummary(priced.lines),
    project: next,
  });
}
