import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  addJobOfficeNote,
  createJobVariationDraft,
  deleteJobVariationDraft,
  getJobOfficeUpdates,
  resolveJobAttention,
} from "@/lib/job-office-updates";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type JobUpdateRequest =
  | {
      action: "add_note";
      text?: string;
      noteType?: string;
      priority?: string;
      followUpRequired?: boolean;
    }
  | {
      action: "create_variation";
      description?: string;
      priority?: string;
      estimatedValue?: number;
      officeNote?: string;
    }
  | {
      action: "resolve_attention";
      kind?: "note" | "variation";
      id?: string;
    }
  | {
      action: "delete_variation";
      id?: string;
    };

function identity(request: Request) {
  return {
    tenantId: request.headers.get("x-hubflo-tenant-id") || "default",
    actor: request.headers.get("x-nexa-auth-user-name") || "NeXa user",
  };
}

export async function GET(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs) return NextResponse.json({ error: "Your role cannot view jobs." }, { status: 403 });
  const { id } = await params;
  const actor = identity(request);
  try {
    return NextResponse.json(getJobOfficeUpdates(actor.tenantId, decodeURIComponent(id)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job updates could not be loaded." },
      { status: 404 },
    );
  }
}

export async function POST(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs) {
    return NextResponse.json({ error: "Your role cannot add or review job updates." }, { status: 403 });
  }
  const body = await parseJsonRequestBody<JobUpdateRequest>(request);
  if (!body?.action) return NextResponse.json({ error: "Choose a job update action." }, { status: 400 });

  const { id } = await params;
  const actor = identity(request);
  const jobIdentifier = decodeURIComponent(id);

  try {
    if (body.action === "add_note") {
      const note = addJobOfficeNote({
        tenantId: actor.tenantId,
        jobIdentifier,
        text: body.text || "",
        noteType: body.noteType,
        priority: body.priority,
        followUpRequired: body.followUpRequired,
        createdBy: actor.actor,
        source: "Core",
      });
      return NextResponse.json({ note, updates: getJobOfficeUpdates(actor.tenantId, jobIdentifier) }, { status: 201 });
    }

    if (body.action === "create_variation") {
      const variation = createJobVariationDraft({
        tenantId: actor.tenantId,
        jobIdentifier,
        description: body.description || "",
        priority: body.priority,
        estimatedValue: body.estimatedValue,
        officeNote: body.officeNote,
        createdBy: actor.actor,
        source: "Core",
      });
      return NextResponse.json({ variation, updates: getJobOfficeUpdates(actor.tenantId, jobIdentifier) }, { status: 201 });
    }

    if (body.action === "delete_variation") {
      if (!body.id) return NextResponse.json({ error: "Variation id is required." }, { status: 400 });
      const variation = deleteJobVariationDraft({
        tenantId: actor.tenantId,
        id: body.id,
        actor: actor.actor,
      });
      return NextResponse.json({ variation, updates: getJobOfficeUpdates(actor.tenantId, jobIdentifier) });
    }

    if (body.action !== "resolve_attention") {
      return NextResponse.json({ error: "Unsupported job update action." }, { status: 400 });
    }

    if (!body.kind || !body.id) {
      return NextResponse.json({ error: "Attention kind and update id are required." }, { status: 400 });
    }
    const update = resolveJobAttention({
      tenantId: actor.tenantId,
      kind: body.kind,
      id: body.id,
      actor: actor.actor,
    });
    return NextResponse.json({ update, updates: getJobOfficeUpdates(actor.tenantId, jobIdentifier) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The job update could not be saved." },
      { status: 400 },
    );
  }
}
