import { NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import type { VersionedMutationResult } from "@/lib/survey-estimator-store";

export const tenantHeaderName = "x-hubflo-tenant-id";

export function surveyRequestContext(request: Request) {
  return {
    access: getAccessProfileFromHeaders(request.headers),
    actor: request.headers.get(employeeHeaderName)?.trim() || "NeXa user",
    tenantId: request.headers.get(tenantHeaderName)?.trim() || "pilot-ewg",
  };
}

export function canReadSurveys(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showJobs || access.showQuotes;
}

export function canManageSurveys(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.canEditJobs || access.canCreateQuote;
}

export function versionedMutationResponse<T>(result: VersionedMutationResult<T>, successStatus = 200) {
  if (result.ok) return NextResponse.json(result.value, { status: successStatus });
  const status = result.reason === "not_found" ? 404 : result.reason === "version_conflict" ? 409 : 422;
  return NextResponse.json(
    { error: result.message, reason: result.reason, current: result.current },
    { status },
  );
}
