import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  applyBlakePipeSizeHints,
  proposeHeatDesignWithBlake,
} from "@/lib/heat-design/blake-ai";
import {
  summariseHeatingFittings,
  type HeatDesignBlakeProposal,
} from "@/lib/heat-design";
import { getHeatDesignProject, saveHeatDesignProject } from "@/lib/heat-design-store";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
  message?: string;
  regenerateLayout?: boolean;
  /** Persist proposal + apply sizing onto the project (default true). */
  apply?: boolean;
};

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json(
      { error: "Sign in with quote access to ask Blake on Heat Design." },
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

  const { actor } = surveyRequestContext(request);
  const proposal = await proposeHeatDesignWithBlake(project, {
    message: body.message,
    regenerateLayout: body.regenerateLayout,
  });

  const apply = body.apply !== false;
  let nextProject = project;
  let fittings = proposal.fittings;

  if (apply) {
    const blakeProposal: HeatDesignBlakeProposal = {
      at: proposal.at,
      summary: proposal.summary,
      narrative: proposal.narrative,
      kitLines: proposal.kitLines,
      clarifyingQuestions: proposal.clarifyingQuestions,
      routeNotes: proposal.routeNotes,
      aiUsed: proposal.aiUsed,
      connected: proposal.connected,
      model: proposal.model,
      error: proposal.error,
    };

    let heatingLayout = proposal.layout || project.heatingLayout;
    if (proposal.applySizing && heatingLayout?.pipes?.length) {
      heatingLayout = applyBlakePipeSizeHints(heatingLayout, proposal.pipeSizes);
      fittings = summariseHeatingFittings(heatingLayout);
    }

    nextProject = saveHeatDesignProject({
      ...project,
      blakeProposal,
      chosenSystemId: proposal.chosenSystemId || project.chosenSystemId,
      emitterMode: proposal.emitterMode || project.emitterMode,
      heatingLayout: heatingLayout ?? project.heatingLayout,
      updatedAt: new Date().toISOString(),
    });

    try {
      appendAuditEvent({
        actor,
        action: "heat_design.blake_propose",
        recordType: "heat_design_project",
        recordId: project.id,
        summary: proposal.aiUsed
          ? `Blake AI proposed kit (${proposal.kitLines.length} lines)${proposal.model ? ` · ${proposal.model}` : ""}`
          : `Blake rule fallback kit (${proposal.kitLines.length} lines)`,
        source: "heat-design",
        importance: "high",
      });
    } catch {
      // non-blocking
    }
  }

  return NextResponse.json({
    ok: true,
    aiUsed: proposal.aiUsed,
    connected: proposal.connected,
    model: proposal.model,
    error: proposal.error,
    summary: proposal.summary,
    narrative: proposal.narrative,
    applySizing: proposal.applySizing,
    regenerateLayout: proposal.regenerateLayout,
    kitLines: proposal.kitLines,
    clarifyingQuestions: proposal.clarifyingQuestions,
    routeNotes: proposal.routeNotes,
    pipeSizes: proposal.pipeSizes,
    fittings,
    project: nextProject,
  });
}
