import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  listAllRecordDocuments,
  listRecordDocuments,
  saveUploadedRecordDocument,
  type RecordDocumentScope,
} from "@/lib/record-documents";

const scopes: RecordDocumentScope[] = ["lead", "quote", "job", "invoice", "tender", "fault"];
const MAX_RECORD_DOCUMENT_BYTES = 250 * 1024 * 1024;

function canManage(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showQuotes || access.showJobs || access.showFinance || access.canCustomize || access.showSchedule;
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

  const requestedFolder = String(formData.get("folderId") || "").trim();
  const requestedVisibility = String(formData.get("visibility") || "").trim();

  const files = formData.getAll("files").filter((item): item is File => typeof File !== "undefined" && item instanceof File);
  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }
  const oversized = files.find((file) => file.size > MAX_RECORD_DOCUMENT_BYTES);
  if (oversized) {
    return NextResponse.json(
      { error: `${oversized.name} is over the 250MB upload limit. Split the file or upload it to Takeoff as a drawing.` },
      { status: 413 },
    );
  }

  const saved = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const isImage = (file.type || "").startsWith("image/");
    const defaultFolderId = isImage
      ? scope === "job"
        ? "mid-work-photos"
        : scope === "fault"
          ? "evidence"
          : "survey-photos"
      : scope === "tender"
        ? "office-private"
        : scope === "fault"
          ? "evidence"
          : "office-private";
    const folderId = requestedFolder || defaultFolderId;
    const visibility =
      requestedVisibility === "Private" ||
      requestedVisibility === "Engineer" ||
      requestedVisibility === "Public" ||
      requestedVisibility === "Client"
        ? requestedVisibility
        : scope === "job" && isImage
          ? "Engineer"
          : "Private";
    saved.push(
      saveUploadedRecordDocument({
        scope,
        recordRef,
        folderId,
        visibility,
        fileName: file.name || "upload.bin",
        mimeType: file.type || "application/octet-stream",
        bytes,
      }),
    );
  }

  return NextResponse.json({ documents: saved }, { status: 201 });
}
