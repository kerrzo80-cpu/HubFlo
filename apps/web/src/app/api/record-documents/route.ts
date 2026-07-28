import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  listAllRecordDocuments,
  listRecordDocuments,
  saveUploadedRecordDocument,
  type RecordDocumentScope,
} from "@/lib/record-documents";

const scopes: RecordDocumentScope[] = ["lead", "quote", "job", "invoice"];

function canManage(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showQuotes || access.showJobs || access.showFinance || access.canCustomize;
}

export async function GET(request: NextRequest) {
  if (!canManage(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const scope = request.nextUrl.searchParams.get("scope") as RecordDocumentScope | null;
  const recordRef = request.nextUrl.searchParams.get("recordRef")?.trim() || "";
  if (scope && scopes.includes(scope) && recordRef) {
    return NextResponse.json({ documents: listRecordDocuments(scope, recordRef) });
  }
  return NextResponse.json({ documents: listAllRecordDocuments() });
}

export async function POST(request: NextRequest) {
  if (!canManage(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const scope = String(formData.get("scope") || "") as RecordDocumentScope;
  const recordRef = String(formData.get("recordRef") || "").trim();
  if (!scopes.includes(scope) || !recordRef) {
    return NextResponse.json({ error: "scope and recordRef are required" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((item): item is File => typeof File !== "undefined" && item instanceof File);
  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }

  const saved = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const isImage = (file.type || "").startsWith("image/");
    saved.push(
      saveUploadedRecordDocument({
        scope,
        recordRef,
        folderId: isImage ? (scope === "job" ? "mid-work-photos" : "survey-photos") : "office-private",
        visibility: scope === "job" && isImage ? "Engineer" : "Private",
        fileName: file.name || "upload.bin",
        mimeType: file.type || "application/octet-stream",
        bytes,
      }),
    );
  }

  return NextResponse.json({ documents: saved }, { status: 201 });
}
