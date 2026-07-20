import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getServerStoreDirectory } from "@/lib/server-store";
import {
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffDocument,
  type TakeoffDocumentKind,
} from "@/lib/takeoff-data";

export const runtime = "nodejs";

const MAX_TAKEOFF_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_TAKEOFF_REQUEST_BYTES = 300 * 1024 * 1024;
const documentKinds: TakeoffDocumentKind[] = ["Drawing", "Marked-up drawing", "Specification", "Contractor BOQ", "Survey note", "Survey photo", "LiDAR scan"];

function isDocumentKind(value: FormDataEntryValue | null): value is TakeoffDocumentKind {
  return typeof value === "string" && documentKinds.includes(value as TakeoffDocumentKind);
}

function safeFileName(fileName: string) {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 140) || "takeoff-document";
}

function inferredMimeType(file: File) {
  if (file.type) return file.type;
  const extension = path.extname(file.name).toLowerCase();
  const knownTypes: Record<string, string> = {
    ".dng": "image/x-adobe-dng",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".json": "application/json",
    ".usd": "model/vnd.usd",
    ".usdz": "model/vnd.usdz+zip",
    ".obj": "model/obj",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".ply": "application/octet-stream",
  };
  return knownTypes[extension];
}

function fileEntries(entries: FormDataEntryValue[]): File[] {
  return entries.filter((entry): entry is File => (
    typeof entry === "object"
    && "arrayBuffer" in entry
    && "name" in entry
    && typeof entry.name === "string"
  ));
}

function uploadNotes(kind: TakeoffDocumentKind) {
  if (kind === "Drawing") return ["Uploaded for OpenAI/takeoff scan; confirm scale and revision."];
  if (kind === "Marked-up drawing") return ["Saved from NeXa Takeoffs with engineer-visible pipe routes and symbols."];
  if (kind === "Specification") return ["Uploaded for OpenAI/specification scan; confirm named manufacturer requirements."];
  if (kind === "Survey note") return ["Uploaded for OpenAI survey quote draft; confirm handwriting, scope and exclusions."];
  if (kind === "Survey photo") return ["Uploaded for OpenAI survey quote draft; confirm room condition and visible measurements."];
  if (kind === "LiDAR scan") return ["Uploaded as LiDAR/RoomPlan evidence; confirm imported room dimensions before quote issue."];
  return ["Uploaded for OpenAI/BOQ scan; check provisional sums and exclusions."];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_TAKEOFF_REQUEST_BYTES) {
    return NextResponse.json({ error: "Upload one file at a time or choose files under 250MB for this pilot." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload could not be read. For RAW photos, try one file at a time or export as JPG/PNG." }, { status: 400 });
  }
  const kind = formData.get("kind");
  if (!isDocumentKind(kind)) {
    return NextResponse.json({ error: "Choose Drawing, Marked-up drawing, Specification, Contractor BOQ, Survey note, Survey photo or LiDAR scan." }, { status: 400 });
  }

  const files = fileEntries(formData.getAll("files"));
  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  const oversized = files.find((file) => file.size > MAX_TAKEOFF_UPLOAD_BYTES);
  if (oversized) {
    return NextResponse.json({ error: `${oversized.name} is over the 250MB pilot upload limit.` }, { status: 413 });
  }

  const uploadedAt = new Date().toISOString();
  const storageRoot = path.join(getServerStoreDirectory(), "takeoff-files", id);
  await mkdir(storageRoot, { recursive: true });

  const documents: TakeoffDocument[] = [];

  for (const file of files) {
    const documentId = `takeoff-doc-${randomUUID()}`;
    const storedFileName = `${documentId}-${safeFileName(file.name)}`;
    const storageKey = ["takeoff-files", id, storedFileName].join("/");
    const filePath = path.join(storageRoot, storedFileName);
    const buffer = Buffer.from(await file.arrayBuffer());

    await writeFile(filePath, buffer);

    documents.push({
      id: documentId,
      kind,
      fileName: file.name,
      mimeType: inferredMimeType(file),
      size: file.size,
      storageKey,
      uploadedAt,
      status: "Uploaded",
      notes: uploadNotes(kind),
    });
  }

  const riskFlags = Array.from(new Set([
    ...project.review.riskFlags,
    "Uploaded source files need AI scan or office review before approval",
  ]));
  const updated = updateTakeoffProject(id, {
    status: project.status === "Draft" ? "In review" : project.status,
    documents: [...documents, ...project.documents],
    review: {
      ...project.review,
      riskFlags,
    },
  });

  if (!updated) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  return NextResponse.json({ project: updated, documents }, { status: 201 });
}
