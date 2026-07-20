import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getServerStoreDirectory } from "@/lib/server-store";
import { getTakeoffProject } from "@/lib/takeoff-data";

export const runtime = "nodejs";

function safeDownloadName(fileName: string) {
  return fileName.replace(/["\r\n\\]+/g, "_") || "takeoff-document";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, documentId } = await params;
  const project = getTakeoffProject(id);
  const document = project?.documents.find((item) => item.id === documentId);
  if (!project || !document?.storageKey) {
    return NextResponse.json({ error: "Takeoff document not found" }, { status: 404 });
  }

  const storeDirectory = getServerStoreDirectory();
  const filePath = path.normalize(path.join(storeDirectory, document.storageKey));
  const allowedRoot = path.normalize(`${storeDirectory}${path.sep}`);
  if (!filePath.startsWith(allowedRoot)) {
    return NextResponse.json({ error: "Invalid document path" }, { status: 403 });
  }

  try {
    const file = await readFile(filePath);
    const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": `${disposition}; filename="${safeDownloadName(document.fileName)}"`,
        "Content-Length": String(file.byteLength),
        "Content-Type": document.mimeType ?? "application/octet-stream",
      },
    });
  } catch {
    return NextResponse.json({ error: "Stored document could not be read" }, { status: 404 });
  }
}
