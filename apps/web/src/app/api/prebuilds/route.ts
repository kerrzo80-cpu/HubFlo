import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { archivePrebuild, listPrebuilds, upsertPrebuild, type PrebuildLineKind } from "@/lib/prebuild-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote && !access.canEditJobs && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
  return NextResponse.json({ kits: listPrebuilds(includeArchived) });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{
    action?: "upsert" | "archive";
    id?: string;
    name?: string;
    category?: string;
    notes?: string;
    lines?: Array<{
      id?: string;
      kind: PrebuildLineKind;
      description: string;
      quantity?: number;
      unitCost?: number;
      unitSell?: number;
      unit?: string;
    }>;
  }>(request);

  try {
    if (body?.action === "archive" && body.id) {
      return NextResponse.json({ kits: archivePrebuild(body.id).kits.filter((kit) => !kit.archived) });
    }
    if (body?.action === "upsert" && body.name) {
      const store = upsertPrebuild({
        id: body.id,
        name: body.name,
        category: body.category,
        notes: body.notes,
        lines: body.lines,
      });
      return NextResponse.json({ kits: store.kits.filter((kit) => !kit.archived) });
    }
    return NextResponse.json({ error: "Unknown pre-build action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update pre-builds." },
      { status: 400 },
    );
  }
}
