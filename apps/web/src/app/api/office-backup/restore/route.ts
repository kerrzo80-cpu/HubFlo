import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { restoreOfficeBackupStores } from "@/lib/office-backup";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  filename?: string;
  dryRun?: boolean;
  confirm?: string;
};

function canManageBackups(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.canCustomize || access.showFinance;
}

/** Dry-run (default) or apply stores.json from a local office tar.gz backup. */
export async function POST(request: NextRequest) {
  if (!canManageBackups(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<Body>(request);
  const filename = body?.filename?.trim() || "";
  if (!filename) {
    return NextResponse.json({ error: "Provide { filename } of a local office backup." }, { status: 400 });
  }

  const result = await restoreOfficeBackupStores(filename, {
    dryRun: body?.dryRun,
    confirm: body?.confirm,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
