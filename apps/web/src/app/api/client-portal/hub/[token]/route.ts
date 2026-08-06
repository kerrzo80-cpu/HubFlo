import { NextResponse } from "next/server";

import { listHubPayload } from "@/lib/client-portal-hub";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const payload = listHubPayload(token);
  if (!payload) {
    return NextResponse.json({ error: "Client hub link not found" }, { status: 404 });
  }

  return NextResponse.json(payload);
}
