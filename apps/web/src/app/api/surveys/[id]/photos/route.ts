import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import type { SurveyPhoto, SurveyPhotoCategory } from "@hubflo/domain";

import { getServerStoreDirectory } from "@/lib/server-store";
import { canManageSurveys, surveyRequestContext } from "@/lib/survey-api";
import { getSurvey, upsertSurveyItem } from "@/lib/survey-estimator-store";

export const runtime = "nodejs";

const maxEvidenceBytes = 25 * 1024 * 1024;
const maxRequestBytes = 30 * 1024 * 1024;
const photoCategories: SurveyPhotoCategory[] = [
  "Room overview",
  "Existing condition",
  "Proposed position",
  "Pipe route",
  "Boiler data plate",
  "Gas meter",
  "Consumer unit",
  "Drainage",
  "Access issue",
  "Damage or making good",
  "Measurement evidence",
  "Other",
];

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 140) || "survey-photo";
}

function inferredMimeType(file: File) {
  if (file.type) return file.type;
  const extension = path.extname(file.name).toLowerCase();
  const knownTypes: Record<string, string> = {
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".dwg": "application/acad",
    ".dxf": "image/vnd.dxf",
    ".json": "application/json",
    ".usd": "model/vnd.usd",
    ".usdz": "model/vnd.usdz+zip",
    ".obj": "model/obj",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".ply": "application/octet-stream",
  };
  return knownTypes[extension] || "application/octet-stream";
}

function filesFrom(entries: FormDataEntryValue[]) {
  return entries.filter((entry): entry is File => (
    typeof entry === "object"
    && entry !== null
    && "arrayBuffer" in entry
    && typeof (entry as File).arrayBuffer === "function"
    && "name" in entry
    && typeof (entry as File).name === "string"
    && (entry as File).name.length > 0
  ));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const { tenantId, actor } = surveyRequestContext(request);
    const survey = getSurvey(tenantId, id);
    if (!survey) return NextResponse.json({ error: "Survey not found" }, { status: 404 });

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      return NextResponse.json({ error: "That upload is too large. Try one photo at a time, or export as JPG/PNG." }, { status: 413 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({
        error: "The survey evidence upload could not be read. Try one photo at a time, or export as JPG/PNG.",
      }, { status: 400 });
    }

    const files = filesFrom(formData.getAll("files"));
    if (!files.length) {
      return NextResponse.json({ error: "Choose at least one survey evidence file." }, { status: 400 });
    }
    const oversized = files.find((file) => file.size > maxEvidenceBytes);
    if (oversized) {
      return NextResponse.json({ error: `${oversized.name} is larger than 100MB.` }, { status: 413 });
    }

    const requestedCategory = String(formData.get("category") || "Other") as SurveyPhotoCategory;
    const category = photoCategories.includes(requestedCategory) ? requestedCategory : "Other";
    const caption = String(formData.get("caption") || "").trim();
    const surveySection = String(formData.get("surveySection") || "Photographs").trim() || "Evidence";
    const linkedScopeItemId = String(formData.get("linkedScopeItemId") || "").trim() || undefined;
    let expectedVersion = Number(formData.get("expectedVersion"));
    if (!Number.isInteger(expectedVersion)) expectedVersion = survey.version;

    const storageRoot = path.join(getServerStoreDirectory(), "survey-files", survey.id);
    await mkdir(storageRoot, { recursive: true });
    const photos: SurveyPhoto[] = [];
    let updatedSurvey = survey;

    for (const file of files) {
      const photoId = `survey-photo-${randomUUID()}`;
      const storedFileName = `${photoId}-${safeFileName(file.name)}`;
      const storageKey = ["survey-files", survey.id, storedFileName].join("/");
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(storageRoot, storedFileName), buffer);
      const photo: SurveyPhoto = {
        id: photoId,
        category,
        fileName: file.name || storedFileName,
        mimeType: inferredMimeType(file),
        size: file.size || buffer.byteLength,
        storageKey,
        caption: caption || file.name || "Survey evidence",
        capturedAt: new Date().toISOString(),
        surveySection,
        linkedScopeItemId,
      };
      const result = upsertSurveyItem(tenantId, survey.id, "photos", photo, expectedVersion, actor);
      if (!result.ok) {
        return NextResponse.json({
          error: result.message,
          reason: result.reason,
          current: result.current,
        }, { status: result.reason === "version_conflict" ? 409 : 422 });
      }
      updatedSurvey = result.value;
      expectedVersion = updatedSurvey.version;
      photos.push(photo);
    }

    return NextResponse.json({ survey: updatedSurvey, photos }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown upload failure";
    return NextResponse.json({
      error: `Unable to save survey evidence (${detail}). Try JPG/PNG, or one file at a time.`,
    }, { status: 500 });
  }
}
