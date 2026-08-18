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

function asNumericArray(value: unknown): number[] {
  if (!value && value !== 0) return [];
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as ArrayLike<number>).map(Number).filter(Number.isFinite);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => asNumericArray(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => /^\d+$/.test(key))
      .map(Number)
      .sort((a, b) => a - b);
    return keys.flatMap((key) => asNumericArray(record[String(key)]));
  }
  return [];
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
  const nums = asNumericArray(value);
  if (nums.length >= 3) {
    const r = nums[0]!;
    const g = nums[1]!;
    const b = nums[2]!;
    // pdf.js sometimes gives 0–1, sometimes 0–255
    const scale = Math.max(r, g, b) > 1.5 ? 255 : 1;
    return { r: r / scale, g: g / scale, b: b / scale };
  }
  return null;
}

/** Rough CMYK → RGB for coloured CAD strokes. */
function parseCmyk(value: unknown): { r: number; g: number; b: number } | null {
  const nums = asNumericArray(value);
  if (nums.length < 4) return null;
  let [c, m, y, k] = nums;
  if (![c, m, y, k].every((n) => Number.isFinite(n))) return null;
  const max = Math.max(c!, m!, y!, k!);
  if (max > 1.5) {
    c = c! / 255;
    m = m! / 255;
    y = y! / 255;
    k = k! / 255;
  }
  return {
    r: (1 - c!) * (1 - k!),
    g: (1 - m!) * (1 - k!),
    b: (1 - y!) * (1 - k!),
  };
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
  if (sat < 0.12 || max < 0.18) return "other";

  // Waste / soil first: brown / orange / amber (red+green, low blue)
  if (r > 0.4 && g > 0.22 && g < r * 0.9 && b < Math.min(r, g) * 0.75 && r - b > 0.15) return "waste";
  // Hot: red / magenta / pink / purple CAD accents
  if (r > 0.4 && r >= g + 0.12 && (r >= b + 0.05 || b >= g + 0.12) && g < 0.55) return "hot";
  // Cold: green / cyan / blue
  if ((g > 0.35 && g >= r + 0.05) || (b > 0.4 && b >= r + 0.08)) return "cold";
  return "other";
}

/**
 * Path payload from pdf.js constructPath.
 * Supports:
 * - interleaved DrawOPS (0 move / 1 line / 2–3 curve / 4 close / 19 rect)
 * - interleaved OPS (13 move / 14 line / 15–17 curve / 18 close / 19 rect)
 * - TypedArray (Float32Array) buffers from modern pdf.js
 */
export function pointsFromConstructPathArgs(pathArgs: unknown): PdfStrokePoint[] {
  const data = asNumericArray(pathArgs);
  const points: PdfStrokePoint[] = [];
  let i = 0;
  while (i < data.length) {
    const op = data[i];
    if (op === undefined) break;

    // moveTo / lineTo — DrawOPS 0/1 or OPS 13/14
    if (op === 0 || op === 1 || op === 13 || op === 14) {
      const x = data[i + 1];
      const y = data[i + 2];
      i += 3;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x: x!, y: y! });
      continue;
    }

    // cubic curveTo — DrawOPS 2 or OPS 15
    if (op === 2 || op === 15) {
      const x = data[i + 5];
      const y = data[i + 6];
      i += 7;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x: x!, y: y! });
      continue;
    }

    // quadratic-ish curveTo2/3 — DrawOPS 3 or OPS 16/17
    if (op === 3 || op === 16 || op === 17) {
      const x = data[i + 3];
      const y = data[i + 4];
      i += 5;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x: x!, y: y! });
      continue;
    }

    // closePath — DrawOPS 4 or OPS 18
    if (op === 4 || op === 18) {
      i += 1;
      if (points[0]) points.push({ ...points[0] });
      continue;
    }

    // rectangle — OPS/DrawOPS 19: x, y, w, h
    if (op === 19) {
      const x = data[i + 1];
      const y = data[i + 2];
      const w = data[i + 3];
      const h = data[i + 4];
      i += 5;
      if (![x, y, w, h].every(Number.isFinite)) continue;
      points.push(
        { x: x!, y: y! },
        { x: x! + w!, y: y! },
        { x: x! + w!, y: y! + h! },
        { x: x!, y: y! + h! },
        { x: x!, y: y! },
      );
      continue;
    }

    i += 1;
  }

  return points.filter((point, index) => {
    if (index === 0) return true;
    const prev = points[index - 1]!;
    return Math.hypot(point.x - prev.x, point.y - prev.y) > 0.2;
  });
}

/** Pull path geometry out of a constructPath args tuple from pdf.js. */
export function pathArgsFromConstructPath(args: unknown): unknown {
  if (!Array.isArray(args) && !ArrayBuffer.isView(args)) return args;
  const list = Array.isArray(args) ? args : [args];
  // Common: [drawOp, pathBuffer, bbox]
  if (list.length >= 2 && (ArrayBuffer.isView(list[1]) || Array.isArray(list[1]))) {
    return list[1];
  }
  // Alternate: [opsBuffer, coordsBuffer, bbox]
  if (list.length >= 2 && ArrayBuffer.isView(list[0]) && ArrayBuffer.isView(list[1])) {
    const ops = Array.from(list[0] as ArrayLike<number>);
    const coords = Array.from(list[1] as ArrayLike<number>);
    const merged: number[] = [];
    let ci = 0;
    for (const op of ops) {
      merged.push(op);
      const need = op === 0 || op === 1 || op === 13 || op === 14
        ? 2
        : op === 2 || op === 15
          ? 6
          : op === 3 || op === 16 || op === 17
            ? 4
            : op === 19
              ? 4
              : 0;
      for (let n = 0; n < need; n += 1) {
        const value = coords[ci];
        ci += 1;
        if (Number.isFinite(value)) merged.push(value!);
      }
    }
    return merged;
  }
  return list.length === 1 ? list[0] : list;
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

type PdfJsLike = {
  OPS: Record<string, number>;
  getDocument: (options: Record<string, unknown>) => { promise: Promise<{
    numPages: number;
    getPage: (pageNumber: number) => Promise<{
      getViewport: (opts: { scale: number }) => { width: number; height: number };
      getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
    }>;
  }> };
};

/**
 * Extract coloured strokes using a caller-supplied pdfjs module.
 * Server routes should use `extractPdfStrokeRuns` from takeoff-pdf-strokes-server
 * (loads pdfjs via Node). Do not import pdfjs-server from this file — it breaks
 * the client Takeoff bundle.
 */
export async function extractPdfStrokeRunsWithEngine(
  pdfjs: PdfJsLike,
  buffer: Buffer | Uint8Array,
  fileName: string,
  options?: { maxPages?: number },
): Promise<PdfStrokeExtractResult> {
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

      if (
        fn === OPS.setStrokeRGBColor
        || fn === OPS.setFillRGBColor
        || fn === OPS.setStrokeCMYKColor
        || fn === OPS.setFillCMYKColor
      ) {
        const raw = Array.isArray(args) ? (args.length >= 3 ? args : args[0]) : args;
        const rgb = (fn === OPS.setStrokeCMYKColor || fn === OPS.setFillCMYKColor)
          ? parseCmyk(raw)
          : parseRgb(raw);
        if (rgb && (fn === OPS.setStrokeRGBColor || fn === OPS.setStrokeCMYKColor)) {
          strokeRgb = rgb;
          strokeHex = toHex(rgb);
        } else if (rgb && classifyStrokeRole(rgb) !== "other") {
          strokeRgb = rgb;
          strokeHex = toHex(rgb);
        }
        continue;
      }

      if (fn === OPS.constructPath) {
        const drawOp = Number(Array.isArray(args) ? args[0] : NaN);
        const pathArgs = pathArgsFromConstructPath(args);
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
