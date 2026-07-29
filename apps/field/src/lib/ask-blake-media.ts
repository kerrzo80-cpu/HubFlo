"use client";

/** Max long edge for Ask Blake uploads (keeps OpenAI / mobile uploads snappy). */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.72;
const TARGET_MAX_CHARS = 900_000; // ~675KB binary after base64

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read photo."));
    image.src = dataUrl;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Shrink iPhone photos before Ask Blake so the request doesn’t hang on mobile data.
 * Converts HEIC/PNG/etc to JPEG when the browser can draw them.
 */
export async function compressAskBlakePhoto(dataUrl: string): Promise<string> {
  if (typeof window === "undefined") return dataUrl;
  if (!dataUrl.startsWith("data:image/")) return dataUrl;

  try {
    const image = await loadImage(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return dataUrl;

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, targetW, targetH);

    let quality = JPEG_QUALITY;
    let output = canvasToJpeg(canvas, quality);
    while (output.length > TARGET_MAX_CHARS && quality > 0.4) {
      quality -= 0.1;
      output = canvasToJpeg(canvas, quality);
    }
    return output.startsWith("data:image/jpeg") ? output : dataUrl;
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
