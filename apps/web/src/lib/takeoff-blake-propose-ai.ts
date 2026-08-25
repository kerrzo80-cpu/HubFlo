/**
 * Live OpenAI enrichment for Takeoff Blake Propose.
 * Suggests plant/emitter placement from drawing context; geometry still applied via rule stubs.
 */

import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import type { StudioPoint } from "@/lib/takeoff-studio";

import type { BlakeEmitterMode, BlakePlantKind, BlakeProposeAnswers } from "./takeoff-blake-propose";
import { openAiFetch } from "@/lib/openai-fetch";

export type BlakeProposeAiPlacement = {
  plantKind: BlakePlantKind;
  emitterMode: BlakeEmitterMode;
  includeCylinder: boolean;
  plantPoint?: StudioPoint;
  emitterPoints: StudioPoint[];
  narrative: string;
  questions: string[];
  aiUsed: boolean;
  connected: boolean;
  model?: string;
  error?: string;
};

type PlacementInput = BlakeProposeAnswers & {
  pageWidth: number;
  pageHeight: number;
  plantPoint?: StudioPoint;
  projectName?: string;
  site?: string;
  description?: string;
  /** Optional note from engineer. */
  message?: string;
  /** Existing AI geometry count on page (for context). */
  existingPinCount?: number;
  pageImageDataUrl?: string;
};

function extractChatText(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content.trim() : "";
}

function clampPoint(p: StudioPoint, pageWidth: number, pageHeight: number): StudioPoint {
  return {
    x: Math.min(pageWidth - 24, Math.max(24, Number(p.x) || 24)),
    y: Math.min(pageHeight - 24, Math.max(24, Number(p.y) || 24)),
  };
}

function asPoint(raw: unknown, pageWidth: number, pageHeight: number): StudioPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { x?: unknown; y?: unknown };
  const x = Number(row.x);
  const y = Number(row.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return clampPoint({ x, y }, pageWidth, pageHeight);
}

/**
 * Ask OpenAI where plant/emitters should sit on the sheet.
 * Returns AI placement hints; caller still runs applyBlakeProposal for geometry.
 */
export async function proposeTakeoffPlacementWithAi(
  input: PlacementInput,
): Promise<BlakeProposeAiPlacement> {
  const openAi = getTakeoffOpenAiConfig();
  const base: BlakeProposeAiPlacement = {
    plantKind: input.plantKind,
    emitterMode: input.emitterMode,
    includeCylinder: input.includeCylinder,
    plantPoint: input.plantPoint,
    emitterPoints: [],
    narrative: "",
    questions: [],
    aiUsed: false,
    connected: Boolean(openAi.apiKey),
    model: openAi.model,
  };

  if (!openAi.apiKey) {
    return {
      ...base,
      error: "OpenAI key missing — using rule stub placement.",
      narrative: "Rule placement (OpenAI not connected).",
    };
  }

  const context = {
    plantKind: input.plantKind,
    emitterMode: input.emitterMode,
    includeCylinder: input.includeCylinder,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    plantPointHint: input.plantPoint || null,
    projectName: input.projectName || "",
    site: input.site || "",
    description: input.description || "",
    existingPinCount: input.existingPinCount || 0,
    engineerNote: input.message || "",
  };

  const promptText = [
    "You are Blake proposing a UK heating plant + emitter layout on a takeoff drawing sheet.",
    "Coordinates are page pixels with origin top-left (x right, y down).",
    "Return JSON only: plantKind (boiler|ashp), emitterMode (radiators|ufh|mixed), includeCylinder (bool),",
    "plantPoint {x,y}, emitterPoints [{x,y}] (2–6 points), narrative (short), questions [string].",
    "Prefer utility/kitchen/garage corners for plant; keep emitters inside likely room zones.",
    "If a plantPointHint is given, stay near it unless the drawing clearly contradicts.",
    "If a page image is attached, use it. Otherwise reason from page size and answers.",
    JSON.stringify(context),
  ].join("\n");

  const hasImage = Boolean(input.pageImageDataUrl?.startsWith("data:image"));
  const userContent = hasImage
    ? [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: input.pageImageDataUrl } },
      ]
    : promptText;

  try {
    const response = await openAiFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAi.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAi.model || "gpt-4.1-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return strict JSON only. Propose plant and emitter positions for a plumbing takeoff sheet.",
          },
          { role: "user", content: userContent },
        ],
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (hasImage) {
        return proposeTakeoffPlacementWithAi({ ...input, pageImageDataUrl: undefined });
      }
      const detail =
        typeof (body as { error?: { message?: string } }).error?.message === "string"
          ? (body as { error: { message: string } }).error.message
          : `OpenAI HTTP ${response.status}`;
      return {
        ...base,
        error: detail,
        narrative: `OpenAI placement failed (${detail}). Using rule stubs.`,
      };
    }

    const text = extractChatText(body);
    if (!text) {
      return {
        ...base,
        error: "Empty OpenAI response",
        narrative: "OpenAI returned empty placement. Using rule stubs.",
      };
    }

    const parsed = JSON.parse(text) as Record<string, unknown>;
    const plantKind: BlakePlantKind = parsed.plantKind === "ashp" ? "ashp" : input.plantKind;
    const emitterMode: BlakeEmitterMode =
      parsed.emitterMode === "ufh" || parsed.emitterMode === "mixed"
        ? parsed.emitterMode
        : parsed.emitterMode === "radiators"
          ? "radiators"
          : input.emitterMode;
    const includeCylinder =
      typeof parsed.includeCylinder === "boolean"
        ? parsed.includeCylinder
        : input.includeCylinder || plantKind === "ashp";

    const plantPoint =
      asPoint(parsed.plantPoint, input.pageWidth, input.pageHeight) || input.plantPoint;

    const emitterPoints = Array.isArray(parsed.emitterPoints)
      ? parsed.emitterPoints
          .map((row) => asPoint(row, input.pageWidth, input.pageHeight))
          .filter((row): row is StudioPoint => Boolean(row))
          .slice(0, 8)
      : [];

    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 8)
      : [];

    return {
      plantKind,
      emitterMode,
      includeCylinder,
      plantPoint,
      emitterPoints,
      narrative:
        String(parsed.narrative || "").trim() ||
        `Live AI placement for ${plantKind} · ${emitterMode}.`,
      questions,
      aiUsed: true,
      connected: true,
      model: openAi.model,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : "OpenAI request failed",
      narrative: "OpenAI placement error. Using rule stubs.",
    };
  }
}
