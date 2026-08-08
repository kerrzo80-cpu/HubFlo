/**
 * Extract coloured vector stroke runs from a PDF drawing.
 * Used by Blake to measure hot/cold/waste pipe graphics (not just text tags).
 */

export type PdfStrokePoint = { x: number; y: number };

export type PdfStrokeRun = {
  pageNumber: number;
  points: PdfStrokePoint[];
  lengthPdfUnits: number;
  colourHex: string;
  role: "hot" | "cold" | "waste" | "other";
  pageWidth: number;
  pageHeight: number;
};

export type PdfStrokeExtractResult = {
  fileName: string;
  runs: PdfStrokeRun[];
  strokeCount: number;
  colouredStrokeCount: number;
};

function polylineLength(points: PdfStrokePoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function parseRgb(value: unknown): { r: number; g: number; b: number } | null {
  if (typeof value === "string") {
    const hex = value.trim();
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (match) {
      const n = Number.parseInt(match[1]!, 16);
      return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
    }
    return null;
  }
  if (Array.isArray(value) && value.length >= 3) {
    const r = Number(value[0]);
    const g = Number(value[1]);
    const b = Number(value[2]);
    if (![r, g, b].every(Number.isFinite)) return null;
    // pdf.js sometimes gives 0–1, sometimes 0–255
    const scale = Math.max(r, g, b) > 1.5 ? 255 : 1;
    return { r: r / scale, g: g / scale, b: b / scale };
  }
  return null;
}

function toHex(rgb: { r: number; g: number; b: number }) {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255)));
  return `#${[clamp(rgb.r), clamp(rgb.g), clamp(rgb.b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Classify drawing stroke colours into plumbing roles. */
export function classifyStrokeRole(rgb: { r: number; g: number; b: number }): PdfStrokeRun["role"] {
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  // Ignore greys / near-black grid / annotation ink
  if (sat < 0.18 || max < 0.2) return "other";

  // Waste / soil first: brown / orange / amber (red+green, low blue)
  if (r > 0.4 && g > 0.22 && g < r * 0.85 && b < Math.min(r, g) * 0.7 && r - b > 0.18) return "waste";
  // Hot: red / magenta / pink (green stays low)
  if (r > 0.45 && r >= g + 0.18 && r >= b + 0.08 && g < 0.45) return "hot";
  // Cold: green / cyan / blue
  if ((g > 0.4 && g >= r + 0.08) || (b > 0.45 && b >= r + 0.1)) return "cold";
  return "other";
}

function asNumberList(value: unknown): number[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((a, b) => a - b);
  return keys.map((key) => Number(record[String(key)])).filter(Number.isFinite);
}

/**
 * Path payload from pdf.js constructPath:
 * interleaved ops + coords: 0=moveTo, 1=lineTo, 2/3=curve, 4=close…
 */
export function pointsFromConstructPathArgs(pathArgs: unknown): PdfStrokePoint[] {
  const data = asNumberList(pathArgs);
  const points: PdfStrokePoint[] = [];
  let i = 0;
  let cursor: PdfStrokePoint | null = null;
  while (i < data.length) {
    const op = data[i];
    if (op === undefined) break;
    if (op === 0 || op === 1) {
      const x = data[i + 1];
      const y = data[i + 2];
      i += 3;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const point = { x: x!, y: y! };
      if (op === 0 || !cursor) {
        points.push(point);
      } else {
        points.push(point);
      }
      cursor = point;
      continue;
    }
    if (op === 2 || op === 3) {
      // cubic/quadratic — take end point
      const x = data[i + (op === 2 ? 5 : 3)];
      const y = data[i + (op === 2 ? 6 : 4)];
      i += op === 2 ? 7 : 5;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const point = { x: x!, y: y! };
      points.push(point);
      cursor = point;
      continue;
    }
    if (op === 4) {
      // closePath
      i += 1;
      if (points[0]) points.push({ ...points[0] });
      continue;
    }
    i += 1;
  }
  // Deduplicate consecutive identical points
  return points.filter((point, index) => {
    if (index === 0) return true;
    const prev = points[index - 1]!;
    return Math.hypot(point.x - prev.x, point.y - prev.y) > 0.2;
  });
}

/** Thin long paths look like pipe runs; fat closed boxes are UI chrome. */
export function looksLikePipeRun(points: PdfStrokePoint[], length: number, pageWidth: number, pageHeight: number) {
  if (points.length < 2 || length < 18) return false;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const diagonal = Math.hypot(pageWidth, pageHeight) || 1;
  if (length < diagonal * 0.01) return false; // tiny ticks
  // Closed fat rectangle → skip
  const closed = points.length >= 4
    && Math.hypot(points[0]!.x - points[points.length - 1]!.x, points[0]!.y - points[points.length - 1]!.y) < 2;
  if (closed && width > 12 && height > 12 && length < (width + height) * 2.4) return false;
  return true;
}

export function summariseStrokeRunsByRole(runs: PdfStrokeRun[]) {
  const totals = { hot: 0, cold: 0, waste: 0, other: 0, count: runs.length };
  for (const run of runs) {
    totals[run.role] += run.lengthPdfUnits;
  }
  return {
    hotPdfUnits: Math.round(totals.hot * 100) / 100,
    coldPdfUnits: Math.round(totals.cold * 100) / 100,
    wastePdfUnits: Math.round(totals.waste * 100) / 100,
    otherPdfUnits: Math.round(totals.other * 100) / 100,
    runCount: totals.count,
    hotRuns: runs.filter((run) => run.role === "hot").length,
    coldRuns: runs.filter((run) => run.role === "cold").length,
    wasteRuns: runs.filter((run) => run.role === "waste").length,
  };
}

async function loadPdfJs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function extractPdfStrokeRuns(
  buffer: Buffer | Uint8Array,
  fileName: string,
  options?: { maxPages?: number },
): Promise<PdfStrokeExtractResult> {
  const pdfjs = await loadPdfJs();
  const OPS = pdfjs.OPS;
  const loadingTask = pdfjs.getDocument({
    data: buffer instanceof Buffer ? new Uint8Array(buffer) : buffer,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const maxPages = Math.min(pdf.numPages, options?.maxPages ?? 8);
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

      if (fn === OPS.setStrokeRGBColor || fn === OPS.setFillRGBColor) {
        // Prefer stroke colour; fill colour also tracked for filled thin pipes.
        const rgb = parseRgb(Array.isArray(args) ? (args.length >= 3 ? args : args[0]) : args);
        if (rgb && fn === OPS.setStrokeRGBColor) {
          strokeRgb = rgb;
          strokeHex = toHex(rgb);
        } else if (rgb && fn === OPS.setFillRGBColor && classifyStrokeRole(rgb) !== "other") {
          strokeRgb = rgb;
          strokeHex = toHex(rgb);
        }
        continue;
      }

      if (fn === OPS.constructPath) {
        const drawOp = Number(Array.isArray(args) ? args[0] : NaN);
        const pathArgs = Array.isArray(args) ? args[1] : null;
        // 20=stroke, 21=closeStroke, 22=fill, 23=eoFill, 24=fillStroke, …
        const isStrokeLike = drawOp === OPS.stroke
          || drawOp === OPS.closeStroke
          || drawOp === OPS.fillStroke
          || drawOp === OPS.closeFillStroke
          || drawOp === OPS.eoFillStroke
          || drawOp === OPS.closeEOFillStroke
          || drawOp === 20
          || drawOp === 21
          || drawOp === 24
          || drawOp === 25;
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
        continue;
      }

      // Legacy discrete path ops (older pdf.js builds)
      if (fn === OPS.stroke || fn === OPS.closeStroke || fn === OPS.fillStroke) {
        strokeCount += 1;
      }
    }
  }

  // Keep the strongest runs — drop tiny leftovers after sorting by length
  runs.sort((a, b) => b.lengthPdfUnits - a.lengthPdfUnits);
  const kept = runs.slice(0, 240);

  return {
    fileName,
    runs: kept,
    strokeCount,
    colouredStrokeCount,
  };
}
