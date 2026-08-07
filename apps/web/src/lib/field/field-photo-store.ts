import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { getServerStoreDirectory } from "@/lib/server-store";

const MAX_FIELD_PHOTO_BYTES = 12 * 1024 * 1024;

export type SavedFieldPhoto = {
  id: string;
  storageKey: string;
  url: string;
  mimeType: string;
  size: number;
  fileName: string;
};

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 140) || "field-photo";
}

function fieldPhotoRoot(scheduleId: string) {
  return path.join(getServerStoreDirectory(), "field-photos", scheduleId);
}

export function fieldPhotoPublicUrl(scheduleId: string, photoId: string) {
  return `/api/field/jobs/${encodeURIComponent(scheduleId)}/photos/${encodeURIComponent(photoId)}`;
}

export function fieldPhotoStorageKey(scheduleId: string, storedFileName: string) {
  return ["field-photos", scheduleId, storedFileName].join("/");
}

export function inferMimeFromName(fileName: string, fallback = "application/octet-stream") {
  const extension = path.extname(fileName).toLowerCase();
  const known: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v",
  };
  return known[extension] || fallback;
}

function decodeBase64Payload(contentBase64: string) {
  const trimmed = contentBase64.trim();
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1] || "application/octet-stream",
      buffer: Buffer.from(dataUrlMatch[2] || "", "base64"),
    };
  }
  return {
    mimeType: "application/octet-stream",
    buffer: Buffer.from(trimmed, "base64"),
  };
}

/** Persist Field job photo/file bytes under the server store directory. */
export function saveFieldPhotoBytes(input: {
  scheduleId: string;
  photoId: string;
  fileName: string;
  contentBase64: string;
  mimeType?: string;
}): SavedFieldPhoto {
  const scheduleId = String(input.scheduleId || "").trim();
  const photoId = String(input.photoId || "").trim();
  if (!scheduleId || !photoId) throw new Error("scheduleId and photoId are required.");

  const decoded = decodeBase64Payload(input.contentBase64);
  if (!decoded.buffer.byteLength) throw new Error("Photo payload was empty.");
  if (decoded.buffer.byteLength > MAX_FIELD_PHOTO_BYTES) {
    throw new Error("That file is larger than 12MB after compression. Try a photo instead of a long video.");
  }

  const mimeType = String(input.mimeType || "").trim() || decoded.mimeType || inferMimeFromName(input.fileName);
  const extension =
    path.extname(input.fileName) ||
    (mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? ".jpg"
      : mimeType.includes("png")
        ? ".png"
        : mimeType.includes("pdf")
          ? ".pdf"
          : mimeType.includes("mp4")
            ? ".mp4"
            : mimeType.includes("webm")
              ? ".webm"
              : ".bin");
  const baseName = path.basename(input.fileName || "field-photo", path.extname(input.fileName || ""));
  const storedFileName = `${photoId}-${safeFileName(baseName)}${extension.startsWith(".") ? extension : `.${extension}`}`;
  const root = fieldPhotoRoot(scheduleId);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, storedFileName), decoded.buffer);

  return {
    id: photoId,
    storageKey: fieldPhotoStorageKey(scheduleId, storedFileName),
    url: fieldPhotoPublicUrl(scheduleId, photoId),
    mimeType,
    size: decoded.buffer.byteLength,
    fileName: input.fileName || storedFileName,
  };
}

export function resolveFieldPhotoPath(scheduleId: string, photoId: string): { filePath: string; mimeType: string } | null {
  const root = fieldPhotoRoot(scheduleId);
  if (!existsSync(root)) return null;
  const match = readdirSync(root).find((name) => name.startsWith(`${photoId}-`) || name === photoId);
  if (!match) return null;
  const filePath = path.join(root, match);
  return {
    filePath,
    mimeType: inferMimeFromName(match, "application/octet-stream"),
  };
}

export function readFieldPhotoBytes(scheduleId: string, photoId: string): { buffer: Buffer; mimeType: string; fileName: string } | null {
  const resolved = resolveFieldPhotoPath(scheduleId, photoId);
  if (!resolved) return null;
  return {
    buffer: readFileSync(resolved.filePath),
    mimeType: resolved.mimeType,
    fileName: path.basename(resolved.filePath),
  };
}

export const FIELD_PHOTO_MAX_BYTES = MAX_FIELD_PHOTO_BYTES;
