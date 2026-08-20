import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth-request";
import { isTrialCompanyResetAllowed } from "@/lib/workspace-mode";
import { wipeTrialCompanyData } from "@/lib/trial-workspace";

export const runtime = "nodejs";

function owner(request: Request) {
  const user = getAuthenticatedUser(request);
  return user?.role === "Owner/Admin" ? user : null;
}

export async function GET(request: Request) {
  if (!isTrialCompanyResetAllowed()) {
    return NextResponse.json({ available: false });
  }
  if (!owner(request)) return NextResponse.json({ available: false });
  return NextResponse.json({
    available: true,
    note: "Clears jobs, tenders, people, catalogue and branding on this trial only. Login accounts are kept.",
  });
}

export async function POST(request: Request) {
  if (!isTrialCompanyResetAllowed()) {
    return NextResponse.json({ error: "Trial reset is not available on this instance." }, { status: 403 });
  }
  if (!owner(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = wipeTrialCompanyData();
  if (result.skipped) {
    return NextResponse.json({ error: "Trial reset is not available on this instance." }, { status: 403 });
  }

  if (process.env.NODE_ENV === "production") {
    setTimeout(() => process.exit(0), 800);
  }

  return NextResponse.json({
    ...result,
    restarting: process.env.NODE_ENV === "production",
    message: "Trial company data cleared. Refresh after a few seconds.",
  });
}
