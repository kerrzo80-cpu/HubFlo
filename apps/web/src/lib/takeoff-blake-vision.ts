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

const CODE_ALIASES: Record<string, { code: string; description: string }> = {
  wc: { code: "P-WC", description: "WC" },
  toilet: { code: "P-WC", description: "WC" },
  whb: { code: "P-WHB", description: "Wash hand basin" },
  basin: { code: "P-WHB", description: "Wash hand basin" },
  bath: { code: "P-BATH", description: "Bath" },
  shower: { code: "P-SHR", description: "Shower" },
  rad: { code: "P-RAD", description: "Radiator" },
  radiator: { code: "P-RAD", description: "Radiator" },
  sink: { code: "P-SINK", description: "Sink" },
  boiler: { code: "P-BOILER", description: "Boiler" },
  cylinder: { code: "P-CYL", description: "Cylinder" },
};

function normaliseCode(raw: string, description: string) {
  const key = `${raw} ${description}`.toLowerCase();
  for (const [alias, mapped] of Object.entries(CODE_ALIASES)) {
    if (key.includes(alias)) return mapped;
  }
  const clean = raw.trim().toUpperCase().replace(/\s+/g, "-") || "P-ITEM";
  return { code: clean.startsWith("P-") ? clean : `P-${clean}`, description: description || clean };
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

async function callVisionModel(
  apiKey: string,
  preferredModel: string,
  images: BlakePageImage[],
): Promise<{ text: string; model: string } | null> {
  const models = [preferredModel, ...VISION_MODELS].filter(
    (model, index, list) => Boolean(model) && list.indexOf(model) === index,
  );

  const prompt = `You are Blake, a UK MEP takeoff assistant looking at a construction drawing screenshot.
Return JSON only:
{
  "summary": string,
  "fixtures": [{"code":"P-WC","description":"WC","count":1,"pageNumber":1,"xPct":0.0-1.0,"yPct":0.0-1.0}],
  "pipes": [{"role":"hot"|"cold"|"waste"|"heating","approxMetres":number,"notes":string}]
}
Rules:
- Prefer plumbing fixtures you can see labels/symbols for (WC, WHB, bath, shower, rad, sink, boiler).
- xPct/yPct are position on the page image (0=left/top, 1=right/bottom). Estimate if unsure.
- For pipes, estimate visible coloured run lengths in metres only if a scale is obvious; otherwise omit approxMetres or use null.
- If unsure, return empty arrays. Never invent dozens of fixtures.`;

  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "low" | "auto" }
  > = [{ type: "input_text", text: prompt }];

  for (const image of images.slice(0, 2)) {
    if (!image.dataUrl || image.dataUrl.length > 900_000) continue;
    content.push({
      type: "input_text",
      text: `Sheet image: ${image.fileName || image.documentId} page ${image.pageNumber}`,
    });
    content.push({
      type: "input_image",
      image_url: image.dataUrl,
      detail: images.length > 1 ? "low" : "auto",
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

/** Run vision on page screenshots; returns measured rows for Studio review/BOQ. */
export async function measureTakeoffPagesWithVision(
  images: BlakePageImage[],
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

  const result = await callVisionModel(config.apiKey, config.model, usable);
  if (!result) return { measured: [], summary: "", model: null, used: false };

  const parsed = parseVisionJson(result.text);
  if (!parsed) return { measured: [], summary: "", model: result.model, used: false };

  const byCode = new Map<string, BlakeVisionMeasuredRow>();
  const pageMeta = usable[0]!;

  for (const fixture of parsed.fixtures || []) {
    const mapped = normaliseCode(String(fixture.code || ""), String(fixture.description || ""));
    const count = Math.max(1, Math.min(40, Math.round(Number(fixture.count) || 1)));
    const pageNumber = Math.max(1, Number(fixture.pageNumber) || pageMeta.pageNumber || 1);
    const docId = usable.find((image) => image.pageNumber === pageNumber)?.documentId || pageMeta.documentId;
    const width = usable.find((image) => image.documentId === docId)?.width || 1000;
    const height = usable.find((image) => image.documentId === docId)?.height || 1400;
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

    for (let index = 0; index < count; index += 1) {
      const xPct = Number.isFinite(fixture.xPct) ? Number(fixture.xPct) : 0.2 + (index % 5) * 0.15;
      const yPct = Number.isFinite(fixture.yPct) ? Number(fixture.yPct) : 0.2 + Math.floor(index / 5) * 0.15;
      // Studio/PDF text path uses bottom-left origin for y; vision gives top-left pct.
      const x = Math.max(0, Math.min(1, xPct)) * width;
      const yTop = Math.max(0, Math.min(1, yPct)) * height;
      const y = height - yTop;
      existing.tagMatches = existing.tagMatches || [];
      existing.tagMatches.push({
        id: `blake-vision-pin-${mapped.code}-${pageNumber}-${index}-${Math.round(x)}-${Math.round(y)}`,
        documentId: docId,
        pageNumber,
        x,
        y,
        pageWidth: width,
        pageHeight: height,
        text: mapped.description,
      });
    }
    existing.quantity = (existing.tagMatches || []).length;
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
  return {
    measured,
    summary: parsed.summary || (measured.length ? `Vision found ${measured.length} item group(s).` : ""),
    model: result.model,
    used: measured.length > 0,
  };
}
