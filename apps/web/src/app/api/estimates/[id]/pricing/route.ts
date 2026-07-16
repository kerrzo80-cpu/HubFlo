import { NextResponse } from "next/server";
import type { PricingProfile } from "@hubflo/domain";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { surveyRequestContext, versionedMutationResponse } from "@/lib/survey-api";
import { updateEstimatePricingProfile } from "@/lib/survey-estimator-store";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<{ expectedVersion?: number; patch?: Partial<PricingProfile>; correctionReason?: string }>(request);
  if (!body?.patch) return NextResponse.json({ error: "Pricing profile update is required." }, { status: 400 });
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  return versionedMutationResponse(updateEstimatePricingProfile(tenantId, id, body.expectedVersion, body.patch, body.correctionReason || "", actor));
}
