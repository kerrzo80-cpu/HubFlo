/**
 * Rasterise a PNG/JPG/WebP or PDF (first page) into a plan underlay image.
 * Client-only — uses browser canvas + pdfjs-dist.
 */

import { polygonBounds, roomPolygon } from "./geometry";
import type { HeatDesignRoom, PlanUnderlay } from "./types";

function roomExtentM(rooms: HeatDesignRoom[]) {
  if (!rooms.length) return { minX: 0, minY: 0, width: 12, height: 9 };
  return polygonBounds(rooms.flatMap((room) => roomPolygon(room)));
}

async function imageAspect(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width / Math.max(1, img.height));
    img.onerror = () => resolve(4 / 3);
    img.src = dataUrl;
  });
}

function underlayFromDataUrl(dataUrl: string, rooms: HeatDesignRoom[], opacity = 0.42): Promise<PlanUnderlay> {
  return (async () => {
    const box = roomExtentM(rooms);
    const widthM = Math.max(6, box.width + 2);
    const aspect = await imageAspect(dataUrl);
    const heightM = widthM / Math.max(0.4, aspect);
    return {
      dataUrl,
      opacity,
      widthM,
      heightM,
      originX: Math.max(0, box.minX - 1),
      originY: Math.max(0, box.minY - 1),
    };
  })();
}

/** Shrink large photos before storing on the Heat Design project. */
async function compressImageDataUrl(raw: string, maxEdge = 1600, quality = 0.72): Promise<string | null> {
  if (!raw.startsWith("data:image/")) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(raw);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(null);
    img.src = raw;
  });
}

async function renderPdfFirstPageToJpeg(bytes: ArrayBuffer, maxEdge = 1600, quality = 0.72): Promise<string | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isOffscreenCanvasSupported: false });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, maxEdge / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: Math.max(0.5, scale) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    if (!canvas.getContext("2d")) return null;
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

function isPdfFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type === "application/pdf" || name.endsWith(".pdf");
}

/**
 * Build a plan underlay from an image or PDF file (first page).
 * Returns null when the file cannot be rasterised.
 */
export async function readPlanUnderlayFile(
  file: File,
  rooms: HeatDesignRoom[],
): Promise<PlanUnderlay | null> {
  if (isPdfFile(file)) {
    const bytes = await file.arrayBuffer();
    const dataUrl = await renderPdfFirstPageToJpeg(bytes);
    if (!dataUrl) return null;
    return underlayFromDataUrl(dataUrl, rooms);
  }

  const raw = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  if (!raw) return null;
  const dataUrl = await compressImageDataUrl(raw);
  if (!dataUrl) return null;
  return underlayFromDataUrl(dataUrl, rooms);
}

/**
 * Rasterise a fetched Takeoff drawing (PDF or image blob) into an underlay.
 */
export async function readPlanUnderlayBlob(
  blob: Blob,
  fileName: string,
  rooms: HeatDesignRoom[],
): Promise<PlanUnderlay | null> {
  const type = blob.type || (fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
  const file = new File([blob], fileName || "drawing.pdf", { type });
  return readPlanUnderlayFile(file, rooms);
}
