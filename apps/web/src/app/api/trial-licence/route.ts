import { NextResponse } from "next/server";

import { getTrialLicenceStatus, publicTrialLicence } from "@/lib/trial-licence";

export const runtime = "nodejs";

/** Public trial clock for login / Setup. Never secrets. Inactive on live and pilot. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    ...publicTrialLicence(getTrialLicenceStatus()),
  });
}
