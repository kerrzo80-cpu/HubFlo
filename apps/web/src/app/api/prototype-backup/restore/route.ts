import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { restorePilotBackup } from "@/lib/pilot-backup";

type RestoreBody = {
  backup?: unknown;
  dryRun?: boolean;
  confirm?: string;
};

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize) {
    return NextResponse.json({ error: "Forbidden — Owner/Admin only." }, { status: 403 });
  }

  const body = await parseJsonRequestBody<RestoreBody>(request);
  if (!body?.backup) {
    return NextResponse.json({ error: "Provide { backup, dryRun?: true }." }, { status: 400 });
  }

  const dryRun = body.dryRun !== false && body.confirm !== "RESTORE";
  // Safety: real restore only when dryRun explicitly false AND confirm === "RESTORE"
  const forceApply = body.dryRun === false && body.confirm === "RESTORE";

  const result = restorePilotBackup(body.backup, { dryRun: !forceApply });
  if (!result.verification.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({
    ...result,
    dryRun: !forceApply,
    message: forceApply
      ? "Backup written to store (pre-restore snapshot saved). Restart the service so in-memory modules reload."
      : "Dry-run only — no stores were overwritten. Prefer POST /api/prototype-backup/fire-drill for a safe shadow round-trip. Pass dryRun:false and confirm:\"RESTORE\" only for a real restore.",
  });
}
