import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import type { SurveyPhoto, SurveyPhotoCategory } from "@hubflo/domain";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getServerStoreDirectory } from "@/lib/server-store";
import { getSurvey, getSurveys, upsertSurveyItem } from "@/lib/survey-estimator-store";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 60 * 1024 * 1024;
const categories: SurveyPhotoCategory[] = [
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

function requestContext(request: Request) {
  return {
    access: getAccessProfileFromHeaders(request.headers),
    tenantId: request.headers.get("x-hubflo-tenant-id")?.trim() || "default",
    actorId: request.headers.get("x-nexa-auth-user-id")?.trim()
      || request.headers.get("x-hubflo-employee-id")?.trim()
      || "nexa-user",
    actorName: request.headers.get("x-nexa-auth-user-name")?.trim() || "Blake user",
  };
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 140) || "survey-photo";
}

function inferredMimeType(file: File) {
  if (file.type) return file.type;
  const extension = path.extname(file.name).toLowerCase();
  const known: Record<string, string> = {
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  return known[extension] || "application/octet-stream";
}

function canManage(access: ReturnType<typeof getAccessProfileFromHeaders>) {
  return access.canCreateQuote || access.canEditJobs;
}

export async function GET(request: Request) {
  const context = requestContext(request);
  if (!canManage(context.access)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const surveys = getSurveys(context.tenantId)
    .filter((survey) => ["Draft", "Ready for review", "Complete", "Sent to estimator"].includes(survey.status))
    .filter((survey) => !survey.surveyorId || survey.surveyorId === context.actorId || survey.surveyorName === context.actorName)
    .slice(0, 12)
    .map((survey) => ({
      id: survey.id,
      reference: survey.reference,
      customerName: survey.customerName,
      siteAddress: survey.siteAddress,
      jobType: survey.jobType,
      status: survey.status,
      photoCount: survey.photos.length,
      updatedAt: survey.updatedAt,
    }));
  return NextResponse.json({ surveys });
}

export async function POST(request: Request) {
  const context = requestContext(request);
  if (!canManage(context.access)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "That upload is too large. Add fewer photos at a time." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "The survey upload could not be read." }, { status: 400 });
  }
  const surveyId = String(form.get("surveyId") || "").trim();
  if (!surveyId) return NextResponse.json({ error: "Choose the survey these files belong to." }, { status: 400 });
  let survey = getSurvey(context.tenantId, surveyId);
  if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
  if (survey.surveyorId && survey.surveyorId !== context.actorId && !context.access.canCustomize) {
    return NextResponse.json({ error: "That survey belongs to another user." }, { status: 403 });
  }

  const files = form.getAll("files").filter((entry): entry is File =>
    typeof entry === "object"
    && entry !== null
    && "arrayBuffer" in entry
    && typeof (entry as File).arrayBuffer === "function"
    && Boolean((entry as File).name),
  );
  if (!files.length) return NextResponse.json({ error: "Choose at least one photo or file." }, { status: 400 });
  const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
  if (oversized) return NextResponse.json({ error: `${oversized.name} is larger than 25MB.` }, { status: 413 });

  const requestedCategory = String(form.get("category") || "Room overview") as SurveyPhotoCategory;
  const category = categories.includes(requestedCategory) ? requestedCategory : "Other";
  const caption = String(form.get("caption") || "").trim();
  const storageRoot = path.join(getServerStoreDirectory(), "survey-files", survey.id);
  await mkdir(storageRoot, { recursive: true });
  const saved: SurveyPhoto[] = [];

  for (const file of files) {
    const id = `survey-photo-${randomUUID()}`;
    const storedFileName = `${id}-${safeFileName(file.name)}`;
    const storageKey = ["survey-files", survey.id, storedFileName].join("/");
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(storageRoot, storedFileName), buffer);
    const photo: SurveyPhoto = {
      id,
      category,
      fileName: file.name,
      mimeType: inferredMimeType(file),
      size: file.size || buffer.byteLength,
      storageKey,
      caption: caption || file.name,
      capturedAt: new Date().toISOString(),
      surveySection: "Ask Ayla evidence",
    };
    const result = upsertSurveyItem(context.tenantId, survey.id, "photos", photo, survey.version, context.actorName);
    if (!result.ok) {
      return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.reason === "version_conflict" ? 409 : 422 });
    }
    survey = result.value;
    saved.push(photo);
  }

  return NextResponse.json({
    ok: true,
    survey: {
      id: survey.id,
      reference: survey.reference,
      customerName: survey.customerName,
      siteAddress: survey.siteAddress,
      photoCount: survey.photos.length,
      version: survey.version,
    },
    photos: saved.map((photo) => ({ id: photo.id, fileName: photo.fileName, category: photo.category })),
  }, { status: 201 });
}
