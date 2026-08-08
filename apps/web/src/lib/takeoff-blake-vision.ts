/**
 * Blake vision fallback for scanned / image-only takeoff sheets.
 * Uses the same OpenAI Responses + input_image pattern as Field Ask Blake.
 */

import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import type { TakeoffConfidence, TakeoffMeasureMethod } from "@/lib/takeoff-skill";

export type BlakePageImage = {
  documentId: string;
  fileName?: string;
  pageNumber: number;
  dataUrl: string;
  width?: number;
  height?: number;
};

/** Optional PDF text items (even sparse OCR/text) to snap vision pins onto. */
export type BlakeTextHint = {
  documentId: string;
  pageNumber: number;
  text: string;
  x: number;
  y: number;
  pageWidth: number;
  pageHeight: number;
};

export type BlakeVisionMeasuredRow = {
  id: string;
  kind: "primary" | "secondary";
  code: string;
  description: string;
  unit: string;
  quantity?: number;
  method?: TakeoffMeasureMethod;
  confidence?: TakeoffConfidence;
  notes?: string;
  tagMatches?: Array<{
    id: string;
    documentId: string;
    pageNumber: number;
    x: number;
    y: number;
    pageWidth?: number;
    pageHeight?: number;
    text?: string;
  }>;
};

type VisionFixture = {
  code?: string;
  description?: string;
  count?: number;
  pageNumber?: number;
  xPct?: number;
  yPct?: number;
};

type VisionPipe = {
  role?: string;
  approxMetres?: number;
  notes?: string;
};

type VisionPayload = {
  summary?: string;
  fixtures?: VisionFixture[];
  pipes?: VisionPipe[];
};

const VISION_MODELS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1"] as const;

const CODE_ALIASES: Record<string, { code: string; description: string; keywords: string[] }> = {
  wc: { code: "P-WC", description: "WC", keywords: ["wc", "toilet", "pan"] },
  toilet: { code: "P-WC", description: "WC", keywords: ["wc", "toilet", "pan"] },
  whb: { code: "P-WHB", description: "Wash hand basin", keywords: ["whb", "basin", "lav"] },
  basin: { code: "P-WHB", description: "Wash hand basin", keywords: ["whb", "basin", "lav"] },
  bath: { code: "P-BATH", description: "Bath", keywords: ["bath"] },
  shower: { code: "P-SHR", description: "Shower", keywords: ["shower", "shr"] },
  rad: { code: "P-RAD", description: "Radiator", keywords: ["rad", "radiator"] },
  radiator: { code: "P-RAD", description: "Radiator", keywords: ["rad", "radiator"] },
  sink: { code: "P-SINK", description: "Sink", keywords: ["sink", "ssk"] },
  boiler: { code: "P-BOILER", description: "Boiler", keywords: ["boiler"] },
  cylinder: { code: "P-CYL", description: "Cylinder", keywords: ["cylinder", "cyl"] },
};

function normaliseCode(raw: string, description: string) {
  const key = `${raw} ${description}`.toLowerCase();
  for (const [alias, mapped] of Object.entries(CODE_ALIASES)) {
    if (key.includes(alias)) {
      return { code: mapped.code, description: mapped.description, keywords: mapped.keywords };
    }
  }
  const clean = raw.trim().toUpperCase().replace(/\s+/g, "-") || "P-ITEM";
  const code = clean.startsWith("P-") ? clean : `P-${clean}`;
  return { code, description: description || clean, keywords: [description, raw].map((s) => s.toLowerCase()).filter(Boolean) };
}

function extractOutputText(body: unknown): string {
  const o = body as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };
  if (o.output_text?.trim()) return o.output_text.trim();
  const parts = (o.output || []).flatMap((item) => item.content || []);
  return parts.map((part) => part.text || "").join("").trim();
}

function parseVisionJson(raw: string): VisionPayload | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(raw.slice(start, end + 1)) as VisionPayload;
  } catch {
    return null;
  }
}

function snapToTextHint(
  documentId: string;
  pageNumber: number,
  x: number,
  y: number,
  pageWidth: number,
  pageHeight: number,
  keywords: string[],
  hints: BlakeTextHint[],
): { x: number; y: number; text?: string; snapped: boolean } {
  const candidates = hints.filter((hint) => {
    if (hint.documentId !== documentId || hint.pageNumber !== pageNumber) return false;
    const text = hint.text.toLowerCase();
    return keywords.some((key) => key && text.includes(key));
  });
  if (!candidates.length) return { x, y, snapped: false };

  let best = candidates[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const hint of candidates) {
    // Hints are PDF bottom-left; vision pin y is also bottom-left after conversion.
    const scaleX = pageWidth / Math.max(hint.pageWidth, 1);
    const scaleY = pageHeight / Math.max(hint.pageHeight, 1);
    const hx = hint.x * scaleX;
    const hy = hint.y * scaleY;
    const dist = Math.hypot(hx - x, hy - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = hint;
    }
  }
  // Only snap when reasonably near (within ~25% of page diagonal).
  const diagonal = Math.hypot(pageWidth, pageHeight);
  if (bestDist > diagonal * 0.25) return { x, y, snapped: false };
  const scaleX = pageWidth / Math.max(best.pageWidth, 1);
  const scaleY = pageHeight / Math.max(best.pageHeight, 1);
  return {
    x: best.x * scaleX,
    y: best.y * scaleY,
    text: best.text,
    snapped: true,
  };
}

async function callVisionModel(
  apiKey: string,
  preferredModel: string,
  images: BlakePageImage[],
  textHints: BlakeTextHint[],
): Promise<{ text: string; model: string } | null> {
  const models = [preferredModel, ...VISION_MODELS].filter(
    (model, index, list) => Boolean(model) && list.indexOf(model) === index,
  );

  const hintLines = textHints.slice(0, 40).map((hint) => {
    const xPct = hint.pageWidth ? hint.x / hint.pageWidth : 0;
    const yTopPct = hint.pageHeight ? 1 - hint.y / hint.pageHeight : 0;
    return `- "${hint.text}" page ${hint.pageNumber} ≈ (${xPct.toFixed(2)}, ${yTopPct.toFixed(2)})`;
  });

  const prompt = `You are Blake, a UK MEP takeoff assistant looking at a construction drawing screenshot.
Return JSON only:
{
  "summary": string,
  "fixtures": [{"code":"P-WC","description":"WC","pageNumber":1,"xPct":0.42,"yPct":0.61}],
  "pipes": [{"role":"hot"|"cold"|"waste"|"heating","approxMetres":number,"notes":string}]
}
Rules:
- One fixture object PER instance (do not use count>1). Repeat the object for each WC/basin/etc.
- xPct/yPct are REQUIRED (0=left/top, 1=right/bottom) at the fixture symbol or label centre.
- Prefer fixtures you can see labels/symbols for (WC, WHB, bath, shower, rad, sink, boiler).
- If text labels below are given, put pins on those labels when they match.
- For pipes, only estimate metres if scale is obvious; otherwise omit.
- If unsure, return empty arrays. Never invent fixtures you cannot see.`;

  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "low" | "auto" | "high" }
  > = [{ type: "input_text", text: prompt }];

  if (hintLines.length) {
    content.push({
      type: "input_text",
      text: `Known text labels on the sheet (top-left %):\n${hintLines.join("\n")}`,
    });
  }

  for (const image of images.slice(0, 2)) {
    if (!image.dataUrl || image.dataUrl.length > 900_000) continue;
    content.push({
      type: "input_text",
      text: `Sheet image: ${image.fileName || image.documentId} page ${image.pageNumber}`,
    });
    content.push({
      type: "input_image",
      image_url: image.dataUrl,
      detail: images.length === 1 ? "high" : "auto",
    });
  }

  if (content.length < 2) return null;

  let lastError: Error | null = null;
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 32_000);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          input: [{ role: "user", content }],
          text: { format: { type: "json_object" } },
        }),
      });
      if (!response.ok) {
        lastError = new Error(`OpenAI vision ${response.status} on ${model}`);
        if (response.status === 401 || response.status === 403) throw lastError;
        continue;
      }
      const text = extractOutputText(await response.json());
      if (!text) {
        lastError = new Error("OpenAI vision returned empty text");
        continue;
      }
      return { text, model };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error(`OpenAI vision timed out on ${model}`);
        continue;
      }
      lastError = error instanceof Error ? error : new Error("OpenAI vision failed");
      if (lastError.message.includes("401") || lastError.message.includes("403")) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) {
    console.warn("[blake-vision]", lastError.message);
  }
  return null;
}

function pipeCode(role: string): { code: string; description: string } | null {
  const clean = role.toLowerCase();
  if (clean.includes("hot") && !clean.includes("heat")) return { code: "P-PIPE-H", description: "Hot pipe runs" };
  if (clean.includes("cold")) return { code: "P-PIPE-C", description: "Cold pipe runs" };
  if (clean.includes("waste") || clean.includes("soil")) return { code: "P-WASTE", description: "Waste / soil runs" };
  if (clean.includes("heat")) return { code: "P-PIPE-HEAT", description: "Heating pipe runs" };
  return null;
}

function expandFixtureInstances(fixture: VisionFixture): VisionFixture[] {
  const count = Math.max(1, Math.min(20, Math.round(Number(fixture.count) || 1)));
  if (count === 1) return [{ ...fixture, count: 1 }];
  // Legacy count>1 responses: fan instances slightly so they aren't stacked.
  return Array.from({ length: count }, (_, index) => ({
    ...fixture,
    count: 1,
    xPct: Number.isFinite(fixture.xPct) ? Number(fixture.xPct) + (index % 3) * 0.02 : undefined,
    yPct: Number.isFinite(fixture.yPct) ? Number(fixture.yPct) + Math.floor(index / 3) * 0.02 : undefined,
  }));
}

/** Run vision on page screenshots; returns measured rows for Studio review/BOQ. */
export async function measureTakeoffPagesWithVision(
  images: BlakePageImage[],
  options: { textHints?: BlakeTextHint[] } = {},
): Promise<{ measured: BlakeVisionMeasuredRow[]; summary: string; model: string | null; used: boolean }> {
  const config = getTakeoffOpenAiConfig();
  if (!config.connected || !images.length) {
    return { measured: [], summary: "", model: null, used: false };
  }

  const usable = images
    .filter((image) => typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image"))
    .map((image) => ({
      ...image,
      dataUrl: image.dataUrl.length > 900_000 ? image.dataUrl.slice(0, 900_000) : image.dataUrl,
    }))
    .slice(0, 2);
  if (!usable.length) return { measured: [], summary: "", model: null, used: false };

  const textHints = Array.isArray(options.textHints) ? options.textHints : [];
  const result = await callVisionModel(config.apiKey, config.model, usable, textHints);
  if (!result) return { measured: [], summary: "", model: null, used: false };

  const parsed = parseVisionJson(result.text);
  if (!parsed) return { measured: [], summary: "", model: result.model, used: false };

  const byCode = new Map<string, BlakeVisionMeasuredRow>();
  const pageMeta = usable[0]!;
  let snappedCount = 0;
  let placedCount = 0;

  const instances = (parsed.fixtures || []).flatMap(expandFixtureInstances);

  for (const fixture of instances) {
    const mapped = normaliseCode(String(fixture.code || ""), String(fixture.description || ""));
    const pageNumber = Math.max(1, Number(fixture.pageNumber) || pageMeta.pageNumber || 1);
    const image = usable.find((row) => row.pageNumber === pageNumber) || usable.find((row) => row.documentId === pageMeta.documentId) || pageMeta;
    const width = image.width || 1000;
    const height = image.height || 1400;

    // Require a real position — no decorative grid of fake pins.
    if (!Number.isFinite(fixture.xPct) || !Number.isFinite(fixture.yPct)) {
      // Last resort: snap purely from matching text hints.
      const fromHint = textHints.find((hint) => {
        if (hint.pageNumber !== pageNumber) return false;
        const text = hint.text.toLowerCase();
        return mapped.keywords.some((key) => key && text.includes(key));
      });
      if (!fromHint) continue;
      fixture.xPct = fromHint.pageWidth ? fromHint.x / fromHint.pageWidth : 0.5;
      fixture.yPct = fromHint.pageHeight ? 1 - fromHint.y / fromHint.pageHeight : 0.5;
    }

    const xPct = Math.max(0.02, Math.min(0.98, Number(fixture.xPct)));
    const yPct = Math.max(0.02, Math.min(0.98, Number(fixture.yPct)));
    const x = xPct * width;
    const yTop = yPct * height;
    const y = height - yTop;

    const snapped = snapToTextHint(
      image.documentId,
      pageNumber,
      x,
      y,
      width,
      height,
      mapped.keywords,
      textHints,
    );
    if (snapped.snapped) snappedCount += 1;
    placedCount += 1;

    const existing = byCode.get(mapped.code) || {
      id: `blake-vision-${mapped.code}`,
      kind: "primary" as const,
      code: mapped.code,
      description: mapped.description,
      unit: "nr",
      quantity: 0,
      method: "vision-count" as const,
      confidence: "Low" as const,
      notes: "Blake vision (scanned sheet) — verify pins before Core push",
      tagMatches: [] as NonNullable<BlakeVisionMeasuredRow["tagMatches"]>,
    };

    existing.tagMatches = existing.tagMatches || [];
    existing.tagMatches.push({
      id: `blake-vision-pin-${mapped.code}-${pageNumber}-${placedCount}-${Math.round(snapped.x)}-${Math.round(snapped.y)}`,
      documentId: image.documentId,
      pageNumber,
      x: snapped.x,
      y: snapped.y,
      pageWidth: width,
      pageHeight: height,
      text: snapped.text || mapped.description,
    });
    existing.quantity = existing.tagMatches.length;
    if (snapped.snapped) {
      existing.confidence = "Medium";
      existing.notes = "Blake vision snapped to sheet text — verify before Core push";
    }
    byCode.set(mapped.code, existing);
  }

  for (const pipe of parsed.pipes || []) {
    const mapped = pipeCode(String(pipe.role || ""));
    const metres = Number(pipe.approxMetres);
    if (!mapped || !(metres > 0) || metres > 500) continue;
    byCode.set(mapped.code, {
      id: `blake-vision-${mapped.code}`,
      kind: "primary",
      code: mapped.code,
      description: mapped.description,
      unit: "m",
      quantity: Number(metres.toFixed(1)),
      method: "vision-area",
      confidence: "Low",
      notes: `Blake vision estimate · ${pipe.notes || "verify with Length / scale"}`.trim(),
      tagMatches: [],
    });
  }

  const measured = [...byCode.values()];
  const summaryBits = [
    parsed.summary || (measured.length ? `Vision found ${measured.length} item group(s)` : ""),
    placedCount ? `${placedCount} pin(s)` : null,
    snappedCount ? `${snappedCount} snapped to text` : null,
  ].filter(Boolean);

  return {
    measured,
    summary: summaryBits.join(" · "),
    model: result.model,
    used: measured.length > 0,
  };
}
