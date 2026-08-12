import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffProject, pushTakeoffProjectToQuote } from "@/lib/takeoff-data";
import { studioNeedsAiReview } from "@/lib/takeoff-studio";

type PushPayload = {
  quoteId?: string;
  createNew?: boolean;
  actor?: string;
  allowPendingAiReview?: boolean;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json(
      {
        error:
          "Your login cannot push Takeoff BoQ to a quote (needs quote-create permission). Use Push to tender if a tender is linked, or ask an office admin.",
      },
      { status: 403 },
    );
  }

  const body = await parseJsonRequestBody<PushPayload>(request);
  const createNew = Boolean(body?.createNew) || !body?.quoteId;
  if (!body?.quoteId && !createNew) {
    return NextResponse.json(
      { error: "Choose a quote or set createNew to push Takeoff output into a new quote" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (project?.studio && studioNeedsAiReview(project.studio) && !body.allowPendingAiReview) {
    return NextResponse.json(
      {
        error: "Blake fixture pins are pending human review. Confirm/reject them or explicitly override before pushing to Core. Pipe runs already on the sheet are not blocked.",
        code: "AI_REVIEW_PENDING",
      },
      { status: 409 },
    );
  }

  const actor = body.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Takeoff";
  const result = pushTakeoffProjectToQuote(id, body.quoteId, actor, { createNew });

  if (!result) {
    return NextResponse.json(
      {
        error: createNew
          ? "Takeoff project must exist and be approved before push"
          : "Takeoff project must exist, be approved and link to an existing quote before push",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ...result, created: createNew && !body?.quoteId });
}
