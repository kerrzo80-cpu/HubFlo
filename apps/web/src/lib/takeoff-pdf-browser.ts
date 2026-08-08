import type { ExtractedPdfDocument, ExtractedPdfPage } from "@/lib/takeoff-pdf-extract";
import {
  classifyStrokeRole,
  looksLikePipeRun,
  pathArgsFromConstructPath,
  pointsFromConstructPathArgs,
  summariseStrokeRunsByRole,
  type PdfStrokeRun,
} from "@/lib/takeoff-pdf-strokes";

const MAX_PAGES = 25;

type PdfCacheEntry = {
  data: Uint8Array;
  at: number;
};

const pdfByteCache = new Map<string, PdfCacheEntry>();

function cacheKey(projectId: string, documentId: string) {
  return `${projectId}::${documentId}`;
}

/** Studio calls this when a drawing successfully opens — Blake reuses the same bytes. */
export function cacheTakeoffPdfBytes(projectId: string, documentId: string, data: Uint8Array) {
  // Clone so later transfers cannot detach the Studio buffer.
  pdfByteCache.set(cacheKey(projectId, documentId), {
    data: new Uint8Array(data),
    at: Date.now(),
  });
  // Keep cache small on phones.
  if (pdfByteCache.size > 6) {
    const oldest = [...pdfByteCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) pdfByteCache.delete(oldest[0]);
  }
}

export function getCachedTakeoffPdfBytes(projectId: string, documentId: string): Uint8Array | null {
  return pdfByteCache.get(cacheKey(projectId, documentId))?.data ?? null;
}

async function loadPdfJsBrowser() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

async function fetchPdfBytes(projectId: string, documentId: string): Promise<Uint8Array> {
  const cached = getCachedTakeoffPdfBytes(projectId, documentId);
  if (cached && cached.byteLength >= 8) return cached;

  const response = await fetch(
    `/api/takeoff-projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/file`,
    { credentials: "include", cache: "no-store" },
  );
  if (response.status === 404) {
    throw new Error("PDF file is missing from storage. Re-upload the drawing, then try Ask Blake again.");
  }
  if (!response.ok) {
    throw new Error(`Unable to open drawing for Blake (${response.status}).`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength < 8) {
    throw new Error("Uploaded drawing file is empty. Re-upload the PDF.");
  }
  cacheTakeoffPdfBytes(projectId, documentId, data);
  return data;
}

function polylineLength(points: Array<{ x: number; y: number }>) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Browser-side PDF text extract — prefers the PDF Studio already opened. */
export async function extractTakeoffPdfInBrowser(
  projectId: string,
  documentId: string,
  fileName: string,
): Promise<ExtractedPdfDocument> {
  const pdfjs = await loadPdfJsBrowser();
  const data = await fetchPdfBytes(projectId, documentId);

  const pdf = await pdfjs.getDocument({ data, isOffscreenCanvasSupported: false }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pages: ExtractedPdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const textItems = [];
    for (const item of textContent.items) {
      if (!item || typeof item !== "object" || !("str" in item)) continue;
      const row = item as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };
      const text = String(row.str || "").trim();
      if (!text) continue;
      const transform = row.transform || [1, 0, 0, 1, 0, 0];
      textItems.push({
        text,
        x: Number(transform[4]) || 0,
        y: Number(transform[5]) || 0,
        width: Number(row.width) || Math.max(6, text.length * 4),
        height: Number(row.height) || 10,
      });
    }
    const fullText = textItems.map((item) => item.text).join(" ");
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      textItems,
      fullText,
      hasSelectableText: textItems.length >= 8,
    });
  }

  return { fileName, pageCount: pdf.numPages, pages };
}

export type ClientStrokePayload = {
  documentId: string;
  fileName: string;
  runs: PdfStrokeRun[];
  colouredStrokeCount: number;
  strokeCount: number;
  summary: ReturnType<typeof summariseStrokeRunsByRole>;
};

/** Trace coloured vector pipe runs in the browser (same PDF Studio is showing). */
export async function extractTakeoffPdfStrokesInBrowser(
  projectId: string,
  documentId: string,
  fileName: string,
  options?: { maxPages?: number },
): Promise<ClientStrokePayload> {
  const pdfjs = await loadPdfJsBrowser();
  const data = await fetchPdfBytes(projectId, documentId);
  const OPS = pdfjs.OPS;
  const pdf = await pdfjs.getDocument({ data, isOffscreenCanvasSupported: false }).promise;
  const maxPages = Math.min(pdf.numPages, options?.maxPages ?? 4);
  const runs: PdfStrokeRun[] = [];
  let strokeCount = 0;
  let colouredStrokeCount = 0;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const opList = await page.getOperatorList();
    let strokeRgb = { r: 0, g: 0, b: 0 };
    let strokeHex = "#000000";

    for (let i = 0; i < opList.fnArray.length; i += 1) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (
        fn === OPS.setStrokeRGBColor
        || fn === OPS.setFillRGBColor
        || fn === OPS.setStrokeCMYKColor
        || fn === OPS.setFillCMYKColor
      ) {
        const raw = Array.isArray(args) ? (args.length >= 3 ? args : args[0]) : args;
        let rgb: { r: number; g: number; b: number } | null = null;
        if (fn === OPS.setStrokeCMYKColor || fn === OPS.setFillCMYKColor) {
          const nums = ArrayBuffer.isView(raw)
            ? Array.from(raw as ArrayLike<number>)
            : Array.isArray(raw)
              ? raw.map(Number)
              : [];
          if (nums.length >= 4 && nums.slice(0, 4).every(Number.isFinite)) {
            let [c, m, y, k] = nums as number[];
            const max = Math.max(c!, m!, y!, k!);
            if (max > 1.5) {
              c = c! / 255; m = m! / 255; y = y! / 255; k = k! / 255;
            }
            rgb = {
              r: (1 - c!) * (1 - k!),
              g: (1 - m!) * (1 - k!),
              b: (1 - y!) * (1 - k!),
            };
          }
        } else if (typeof raw === "string" && /^#?[0-9a-f]{6}$/i.test(raw.trim())) {
          const n = Number.parseInt(raw.replace("#", ""), 16);
          rgb = { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
        } else {
          const nums = ArrayBuffer.isView(raw)
            ? Array.from(raw as ArrayLike<number>)
            : Array.isArray(raw)
              ? raw.map(Number)
              : [];
          if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) {
            const scale = Math.max(nums[0]!, nums[1]!, nums[2]!) > 1.5 ? 255 : 1;
            rgb = { r: nums[0]! / scale, g: nums[1]! / scale, b: nums[2]! / scale };
          }
        }
        if (rgb && (fn === OPS.setStrokeRGBColor || fn === OPS.setStrokeCMYKColor || classifyStrokeRole(rgb) !== "other")) {
          strokeRgb = rgb;
          const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255)));
          strokeHex = `#${[clamp(rgb.r), clamp(rgb.g), clamp(rgb.b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        }
        continue;
      }

      if (fn === OPS.constructPath) {
        const drawOp = Number(Array.isArray(args) ? args[0] : NaN);
        const pathArgs = pathArgsFromConstructPath(args);
        const isStrokeLike = drawOp === OPS.stroke
          || drawOp === OPS.closeStroke
          || drawOp === OPS.fillStroke
          || drawOp === OPS.closeFillStroke
          || drawOp === OPS.eoFillStroke
          || drawOp === OPS.closeEOFillStroke
          || drawOp === 20
          || drawOp === 21
          || drawOp === 24
          || drawOp === 25
          || drawOp === 26
          || drawOp === 27;
        if (!isStrokeLike) continue;
        strokeCount += 1;
        const role = classifyStrokeRole(strokeRgb);
        if (role === "other") continue;
        colouredStrokeCount += 1;
        const points = pointsFromConstructPathArgs(pathArgs);
        const length = polylineLength(points);
        if (!looksLikePipeRun(points, length, viewport.width, viewport.height)) continue;
        runs.push({
          pageNumber,
          points,
          lengthPdfUnits: length,
          colourHex: strokeHex,
          role,
          pageWidth: viewport.width,
          pageHeight: viewport.height,
        });
      }
    }
  }

  runs.sort((a, b) => b.lengthPdfUnits - a.lengthPdfUnits);
  const kept = runs.slice(0, 240);
  return {
    documentId,
    fileName,
    runs: kept,
    colouredStrokeCount,
    strokeCount,
    summary: summariseStrokeRunsByRole(kept),
  };
}
