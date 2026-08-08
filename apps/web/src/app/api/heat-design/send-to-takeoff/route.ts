import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getHeatDesignProject, saveHeatDesignProject } from "@/lib/heat-design-store";
import {
  applyBlakePipeSizing,
  heatDesignTakeoffDescription,
  heatingLayoutToStudio,
  reducerMaterialAllowances,
  summariseHeatingFittings,
} from "@/lib/heat-design";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";
import { createTakeoffProject, getTakeoffProject, updateTakeoffProject } from "@/lib/takeoff-data";

type Body = {
  projectId?: string;
  takeoffId?: string;
  createNew?: boolean;
};

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json(
      { error: "Sign in with quote access to send Heat Design into Takeoff." },
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
  if (!project.heatingLayout?.pipes?.length) {
    return NextResponse.json(
      { error: "Design on plan first — Blake needs a heating layout to send." },
      { status: 409 },
    );
  }

  const { actor } = surveyRequestContext(request);
  const sizedLayout = applyBlakePipeSizing(project.heatingLayout);
  const { studio, fittings } = heatingLayoutToStudio(sizedLayout, { projectName: project.name });
  const description = heatDesignTakeoffDescription(project, fittings);

  const createNew = Boolean(body.createNew) || !body.takeoffId && !project.linkedTakeoffId;
  const targetId = createNew ? undefined : (body.takeoffId || project.linkedTakeoffId);

  let takeoff = targetId ? getTakeoffProject(targetId) : null;
  if (targetId && !takeoff) {
    return NextResponse.json({ error: "Linked takeoff was not found." }, { status: 404 });
  }

  if (!takeoff) {
    takeoff = createTakeoffProject({
      name: `${project.name} · heating takeoff`,
      customer: project.customerName || "Customer to confirm",
      site: [project.address, project.postcode].filter(Boolean).join(", ") || "Site to confirm",
      description,
      linkedQuoteId: project.linkedQuoteId,
      linkedQuoteRef: project.linkedQuoteRef,
      linkedJobId: project.linkedJobId,
      linkedJobRef: project.linkedJobRef,
      studio,
      status: "Draft",
      materialAllowances: [],
    });
    takeoff = updateTakeoffProject(takeoff.id, {
      materialAllowances: reducerMaterialAllowances(fittings, takeoff.id),
    }) || takeoff;
  } else {
    const nextReducers = reducerMaterialAllowances(fittings, takeoff.id);
    const kept = (takeoff.materialAllowances || []).filter(
      (line) => !line.id.startsWith(`studio-mat-${takeoff!.id}-reducer-`),
    );
    takeoff = updateTakeoffProject(takeoff.id, {
      studio,
      description,
      materialAllowances: [...kept, ...nextReducers],
      status: takeoff.status === "Draft" ? "Draft" : takeoff.status,
    });
    if (!takeoff) {
      return NextResponse.json({ error: "Could not update takeoff project." }, { status: 500 });
    }
  }

  const savedHeat = saveHeatDesignProject({
    ...project,
    heatingLayout: sizedLayout,
    linkedTakeoffId: takeoff.id,
    linkedTakeoffRef: takeoff.reference,
  });

  try {
    appendAuditEvent({
      actor,
      action: "heat_design_send_takeoff",
      recordType: "takeoff_project",
      recordId: takeoff.id,
      summary: `Heat Design → Takeoff · ${fittings.totalMetres} m · ${fittings.totalElbows} elbows · ${fittings.totalReducers} reducers`,
      source: "heat design",
      importance: "high",
    });
  } catch {
    // non-blocking
  }

  return NextResponse.json({
    ok: true,
    project: savedHeat,
    takeoff: {
      id: takeoff.id,
      reference: takeoff.reference,
      name: takeoff.name,
    },
    fittings: summariseHeatingFittings(sizedLayout),
    created: createNew || !targetId,
  });
}
