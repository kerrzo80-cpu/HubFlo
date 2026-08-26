import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { purgeJobDeliveryEventFromHub } from "@/lib/hub-detail-store";
import { deleteVariationPortalByEventId } from "@/lib/variation-portal-data";
import { getJobs } from "@/lib/workflow-data";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Delete a commercial (non-daywork) job variation delivery event. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs) {
    return NextResponse.json({ error: "Your role cannot delete variations." }, { status: 403 });
  }

  const { id: jobId } = await params;
  const job = getJobs().find((item) => item.id === jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const variationEventId = new URL(request.url).searchParams.get("variationEventId")?.trim();
  if (!variationEventId) {
    return NextResponse.json({ error: "variationEventId query param required" }, { status: 400 });
  }
  if (variationEventId.startsWith("daywork-")) {
    return NextResponse.json(
      { error: "Delete daywork variations from the Daywork form or Dayworks register." },
      { status: 400 },
    );
  }

  const hub = purgeJobDeliveryEventFromHub({ jobId, eventId: variationEventId });
  const removedPortal = deleteVariationPortalByEventId(variationEventId);

  return NextResponse.json({
    ok: true,
    deleted: true,
    removedPortal,
    jobDeliveryEvents: hub.jobDeliveryEvents ?? [],
  });
}
