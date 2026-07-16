import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import type { SurveyPhoto, SurveyPhotoCategory } from "@hubflo/domain";

import { getServerStoreDirectory } from "@/lib/server-store";
import { canManageSurveys, surveyRequestContext } from "@/lib/survey-api";
import { getSurvey, upsertSurveyItem } from "@/lib/survey-estimator-store";

export const runtime = "nodejs";

const maxPhotoBytes = 25 * 1024 * 1024;
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

function filesFrom(entries: FormDataEntryValue[]) {
  return entries.filter((entry): entry is File => typeof entry === "object" && "arrayBuffer" in entry && "name" in entry);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const { tenantId, actor } = surveyRequestContext(request);
  const survey = getSurvey(tenantId, id);
  if (!survey) return NextResponse.json({ error: "Survey not found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "The photo upload could not be read." }, { status: 400 });
  }
  const files = filesFrom(formData.getAll("files"));
  if (!files.length) return NextResponse.json({ error: "Choose at least one photograph." }, { status: 400 });
  const oversized = files.find((file) => file.size > maxPhotoBytes);
  if (oversized) return NextResponse.json({ error: `${oversized.name} is larger than 25MB.` }, { status: 413 });

  const requestedCategory = String(formData.get("category") || "Other") as SurveyPhotoCategory;
  const category = photoCategories.includes(requestedCategory) ? requestedCategory : "Other";
  const caption = String(formData.get("caption") || "").trim();
  const surveySection = String(formData.get("surveySection") || "Photographs").trim();
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
    await writeFile(path.join(storageRoot, storedFileName), Buffer.from(await file.arrayBuffer()));
    const photo: SurveyPhoto = {
      id: photoId,
      category,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storageKey,
      caption,
      capturedAt: new Date().toISOString(),
      surveySection,
      linkedScopeItemId,
    };
    const result = upsertSurveyItem(tenantId, survey.id, "photos", photo, expectedVersion, actor);
    if (!result.ok) {
      return NextResponse.json({ error: result.message, reason: result.reason, current: result.current }, { status: result.reason === "version_conflict" ? 409 : 422 });
    }
    updatedSurvey = result.value;
    expectedVersion = updatedSurvey.version;
    photos.push(photo);
  }

  return NextResponse.json({ survey: updatedSurvey, photos }, { status: 201 });
}
