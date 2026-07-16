import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth-request";
import { isUserAuthenticationEnabled } from "@/lib/auth-store";
import { getWorkspaceMode } from "@/lib/workspace-mode";

export async function GET(request: Request) {
  const workspaceMode = getWorkspaceMode();
  if (!isUserAuthenticationEnabled()) {
    return NextResponse.json({ mode: "pilot", workspaceMode, user: null });
  }
  const user = getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  return NextResponse.json({ mode: "users", workspaceMode, user });
}
