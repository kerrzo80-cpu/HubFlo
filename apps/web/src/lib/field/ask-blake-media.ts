"use client";

/** Max long edge for Ask Blake uploads (keeps OpenAI / mobile uploads snappy). */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.72;
const TARGET_MAX_CHARS = 900_000; // ~675KB binary after base64
/** Reject only absurd files — real phone cameras often land 15–50MB before shrink. */
export const ASK_BLAKE_RAW_PHOTO_LIMIT_BYTES = 80 * 1024 * 1024;

function loadImageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read photo."));
    image.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return canvas.toDataURL("image/jpeg", quality);
}

function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (!width || !height) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, targetW, targetH);
  return canvas;
}

function encodeCanvas(canvas: HTMLCanvasElement) {
  let quality = JPEG_QUALITY;
  let output = canvasToJpeg(canvas, quality);
  while (output.length > TARGET_MAX_CHARS && quality > 0.35) {
    quality -= 0.08;
    output = canvasToJpeg(canvas, quality);
  }
  // Still huge? Shrink the canvas once more.
  if (output.length > TARGET_MAX_CHARS) {
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.round(canvas.width * 0.7));
    smaller.height = Math.max(1, Math.round(canvas.height * 0.7));
    const context = smaller.getContext("2d");
    if (context) {
      context.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      output = canvasToJpeg(smaller, 0.55);
    }
  }
  return output.startsWith("data:image/jpeg") ? output : "";
}

async function compressFromBitmap(file: File): Promise<string | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = drawScaled(bitmap, bitmap.width, bitmap.height);
    if (!canvas) return null;
    const output = encodeCanvas(canvas);
    return output || null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

async function compressFromObjectUrl(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImageFromUrl(url);
    const canvas = drawScaled(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
    if (!canvas) return null;
    const output = encodeCanvas(canvas);
    return output || null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) reject(new Error("empty"));
      else resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Shrink phone-camera photos (often 15–50MB) before Ask Blake attaches them.
 * Prefer bitmap / object-URL decode so we never hold a 48MB base64 string in memory.
 */
export async function compressAskBlakeFile(file: File): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Photo compression only runs in the browser.");
  }

  const fromBitmap = await compressFromBitmap(file);
  if (fromBitmap) return fromBitmap;

  const fromUrl = await compressFromObjectUrl(file);
  if (fromUrl) return fromUrl;

  // Last resort: full data-URL path (older browsers / awkward HEIC cases).
  const dataUrl = await readFileAsDataUrl(file);
  return compressAskBlakePhoto(dataUrl);
}

/**
 * Shrink already-attached data URLs (e.g. before send).
 */
export async function compressAskBlakePhoto(dataUrl: string): Promise<string> {
  if (typeof window === "undefined") return dataUrl;
  if (!dataUrl.startsWith("data:image/")) return dataUrl;

  try {
    const image = await loadImageFromUrl(dataUrl);
    const canvas = drawScaled(
      image,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    );
    if (!canvas) return dataUrl;
    return encodeCanvas(canvas) || dataUrl;
  } catch {
    // If the browser can’t decode (rare HEIC cases), keep the original.
    return dataUrl;
  }
}

export async function compressAskBlakePhotos(dataUrls: string[]) {
  const next: string[] = [];
  for (const item of dataUrls) {
    next.push(await compressAskBlakePhoto(item));
  }
  return next;
}

export async function compressAskBlakeFiles(files: File[]) {
  const next: string[] = [];
  for (const file of files) {
    next.push(await compressAskBlakeFile(file));
  }
  return next;
}

export function askBlakeFetchTimeoutMs() {
  return 40_000;
}

export function withAskBlakeTimeout(ms = askBlakeFetchTimeoutMs()) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}
