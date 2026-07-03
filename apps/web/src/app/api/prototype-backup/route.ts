import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { readServerStoreSnapshot } from "@/lib/server-store";

const pilotStoreNames = [
  "people-store",
  "lead-store",
  "workflow-store",
  "hub-detail-store",
  "takeoff-store",
  "variation-portal-store",
];

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const generatedAt = new Date().toISOString();
  const stores = Object.fromEntries(
    pilotStoreNames.map((name) => [name, readServerStoreSnapshot(name)]),
  );
  const body = JSON.stringify(
    {
      product: "NeXa pilot",
      purpose: "Stress-test backup",
      generatedAt,
      stores,
    },
    null,
    2,
  );

  return new NextResponse(body, {
    headers: {
      "Content-Disposition": `attachment; filename="nexa-pilot-backup-${generatedAt.slice(0, 10)}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
