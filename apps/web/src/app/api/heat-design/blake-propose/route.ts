import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  applyBlakePipeSizeHints,
  proposeHeatDesignWithBlake,
} from "@/lib/heat-design/blake-ai";
import {
  summariseHeatingFittings,
  type HeatDesignBlakeProposal,
  type HeatDesignProject,
} from "@/lib/heat-design";
import { getHeatDesignProject, saveHeatDesignProject } from "@/lib/heat-design-store";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
  /** Client snapshot — Ask Blake must not race the debounced autosave. */
  project?: HeatDesignProject;
  message?: string;
  regenerateLayout?: boolean;
  /** Persist proposal + apply sizing onto the project (default true). */
  apply?: boolean;
};

function mergeClientSnapshot(
  stored: HeatDesignProject,
  client: HeatDesignProject | undefined,
): HeatDesignProject {
  if (!client || client.id !== stored.id) return stored;
  return {
    ...stored,
    ...client,
    id: stored.id,
    // Prefer client geometry — plant/rooms/pipes the engineer just placed.
    rooms: Array.isArray(client.rooms) ? client.rooms : stored.rooms,
    heatingLayout: client.heatingLayout ?? stored.heatingLayout,
    planUnderlay: client.planUnderlay ?? stored.planUnderlay,
    chosenSystemId: client.chosenSystemId || stored.chosenSystemId,
    emitterMode: client.emitterMode || stored.emitterMode,
    updatedAt: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json(
      { error: "Sign in with quote access to ask Blake on Heat Design." },
      { status: 403 },
    );
  }

  const body = (await parseJsonRequestBody<Body>(request)) || {};
  const projectId = body.projectId?.trim() || body.project?.id?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const stored = getHeatDesignProject(projectId);
  if (!stored) {
    return NextResponse.json({ error: "Heat Design project not found" }, { status: 404 });
  }

  const project = mergeClientSnapshot(stored, body.project);
  const { actor } = surveyRequestContext(request);
  const proposal = await proposeHeatDesignWithBlake(project, {
    message: body.message,
    // Default: design on plan. Client may omit; plant/rooms still force redesign in blake-ai.
    regenerateLayout: body.regenerateLayout !== false,
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
          ? `Blake AI designed layout + kit (${proposal.layout?.pipes?.length || 0} pipes, ${proposal.kitLines.length} lines)${proposal.model ? ` · ${proposal.model}` : ""}`
          : `Blake rule design + kit (${proposal.layout?.pipes?.length || 0} pipes, ${proposal.kitLines.length} lines)`,
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
    pipeCount: proposal.layout?.pipes?.length || nextProject.heatingLayout?.pipes?.length || 0,
    project: nextProject,
  });
}
