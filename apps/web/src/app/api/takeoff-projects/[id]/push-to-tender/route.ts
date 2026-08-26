import { NextRequest, NextResponse } from "next/server";

import {
  canPushTakeoffToTender,
  employeeHeaderName,
  getAccessProfileFromHeaders,
} from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffProject } from "@/lib/takeoff-data";
import { pushTakeoffProjectToTender } from "@/lib/takeoff-tender-push";
import { studioNeedsAiReview } from "@/lib/takeoff-studio";

type PushTenderPayload = {
  tenderId?: string;
  actor?: string;
  allowPendingAiReview?: boolean;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canPushTakeoffToTender(access)) {
    return NextResponse.json(
      {
        error:
          "Your login cannot push Takeoff BoQ to a tender (needs takeoff edit and tender edit rights). Ask an office admin, or sign in with an Office account.",
      },
      { status: 403 },
    );
  }

  const body = await parseJsonRequestBody<PushTenderPayload>(request);
  const tenderId = body?.tenderId?.trim();
  if (!tenderId) {
    return NextResponse.json(
      { error: "Link a Core tender first, then Push to tender." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  if (project.studio && studioNeedsAiReview(project.studio) && !body?.allowPendingAiReview) {
    return NextResponse.json(
      {
        error:
          "Blake fixture pins are pending human review. Confirm/reject them or explicitly override before pushing to Core. Pipe runs already on the sheet are not blocked.",
        code: "AI_REVIEW_PENDING",
      },
      { status: 409 },
    );
  }

  const actor = body?.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Takeoff";
  const result = pushTakeoffProjectToTender(id, tenderId, actor);

  if (!result) {
    return NextResponse.json(
      {
        error:
          "Could not push Takeoff BoQ to the tender. Approve the takeoff, ensure the tender exists, and that there are measured BoQ lines to push.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ...result,
    note: `Open Core → Tenders → “${result.tender.name}” → BoQ. Lines are split into ${result.sheetCount} Takeoff · house-type sheet(s), with Heating / Hot & cold / Gas as sections inside each tab.`,
  });
}
