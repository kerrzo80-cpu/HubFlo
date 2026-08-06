"use client";

import {
  ASK_BLAKE_RAW_PHOTO_LIMIT_BYTES,
  compressAskBlakeFile,
  frameFromAskBlakeVideo,
} from "@/lib/field/ask-blake-media";

export type FieldPhotoUploadPayload = {
  name: string;
  type: "PDF" | "Photo" | "Note" | "Video";
  contentBase64: string;
  mimeType: string;
  size: number;
};

const MAX_NON_IMAGE_BYTES = 8 * 1024 * 1024;

function attachmentKindFromFile(file: File): FieldPhotoUploadPayload["type"] {
  const lower = `${file.type} ${file.name}`.toLowerCase();
  if (lower.includes("video") || /\.(mp4|mov|webm|m4v)$/i.test(file.name)) return "Video";
  if (lower.includes("pdf") || /\.(pdf|docx?|xlsx?|txt)$/i.test(file.name)) return "PDF";
  if (lower.includes("image") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) return "Photo";
  return "Note";
}

function dataUrlToBase64(dataUrl: string) {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(dataUrl);
  return match?.[1] || "";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) reject(new Error("Could not read that file."));
      else resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

/** Compress photos (and video stills) or read small PDFs for Field sync / outbox. */
export async function prepareFieldUploadFile(file: File): Promise<FieldPhotoUploadPayload> {
  const kind = attachmentKindFromFile(file);

  if (kind === "Photo" || file.type.startsWith("image/")) {
    if (file.size > ASK_BLAKE_RAW_PHOTO_LIMIT_BYTES) {
      throw new Error(`${file.name} is too large even to shrink (over 80MB). Try another shot.`);
    }
    const dataUrl = await compressAskBlakeFile(file);
    const contentBase64 = dataUrlToBase64(dataUrl);
    if (!contentBase64) throw new Error(`Could not compress ${file.name}.`);
    const approxBytes = Math.round((contentBase64.length * 3) / 4);
    return {
      name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      type: "Photo",
      contentBase64,
      mimeType: "image/jpeg",
      size: approxBytes,
    };
  }

  if (kind === "Video") {
    // Store a still frame as the synced evidence — full video blobs blow past outbox limits.
    const dataUrl = await frameFromAskBlakeVideo(file);
    const contentBase64 = dataUrlToBase64(dataUrl);
    if (!contentBase64) throw new Error(`Could not capture a still from ${file.name}.`);
    const approxBytes = Math.round((contentBase64.length * 3) / 4);
    return {
      name: file.name.replace(/\.[^.]+$/, "") + "-still.jpg",
      type: "Photo",
      contentBase64,
      mimeType: "image/jpeg",
      size: approxBytes,
    };
  }

  if (file.size > MAX_NON_IMAGE_BYTES) {
    throw new Error(`${file.name} is larger than 8MB. Compress it or take a photo instead.`);
  }
  const dataUrl = await readFileAsDataUrl(file);
  const contentBase64 = dataUrlToBase64(dataUrl);
  if (!contentBase64) throw new Error(`Could not read ${file.name}.`);
  return {
    name: file.name,
    type: kind,
    contentBase64,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
}

export async function prepareFieldUploadFiles(files: File[]) {
  const prepared: FieldPhotoUploadPayload[] = [];
  for (const file of files.slice(0, 10)) {
    prepared.push(await prepareFieldUploadFile(file));
  }
  return prepared;
}
