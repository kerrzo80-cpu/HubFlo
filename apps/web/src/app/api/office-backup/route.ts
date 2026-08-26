import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  getOfficeBackupStatus,
  maybeRunScheduledOfficeBackup,
  resolveOfficeBackupFile,
  runOfficeBackup,
} from "@/lib/office-backup";
import { officeBackupS3Configured } from "@/lib/office-backup-s3";

export const runtime = "nodejs";
export const maxDuration = 300;

function canManageBackups(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.canCustomize || access.showFinance;
}

export async function GET(request: NextRequest) {
  if (!canManageBackups(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filename = request.nextUrl.searchParams.get("download")?.trim() || "";
  if (filename) {
    const file = resolveOfficeBackupFile(filename);
    if (!file) {
      return NextResponse.json({ error: "That backup file was not found." }, { status: 404 });
    }
    const stream = Readable.toWeb(createReadStream(file.full));
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Content-Length": String(file.bytes),
        "Cache-Control": "no-store",
      },
    });
  }

  const scheduled = maybeRunScheduledOfficeBackup();
  const status = getOfficeBackupStatus();
  return NextResponse.json({
    ok: true,
    s3Configured: officeBackupS3Configured(),
    scheduled,
    ...status,
    note: "Download a backup and keep it off this server (Google Drive or the office NAS). Render disk copies are wiped if the disk is lost.",
  });
}

export async function POST(request: NextRequest) {
  if (!canManageBackups(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await runOfficeBackup();
  const status = getOfficeBackupStatus();
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Backup failed.", status }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    result,
    status,
    s3Configured: officeBackupS3Configured(),
  });
}
