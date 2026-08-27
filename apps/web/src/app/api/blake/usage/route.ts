import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getBlakeAiSpendGuard } from "@/lib/blake-ai-usage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = request.headers.get("x-hubflo-tenant-id")?.trim() || process.env.NEXA_TENANT_KEY?.trim() || "default";
  return NextResponse.json(getBlakeAiSpendGuard(tenantId));
}
