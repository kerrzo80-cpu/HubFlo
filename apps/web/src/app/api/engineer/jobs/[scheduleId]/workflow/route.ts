import { NextResponse } from "next/server";

import { getEngineerScheduleItem } from "@/lib/engineer-data";
import {
  applyEngineerWorkflowAction,
  getEngineerJobWorkflow,
  type EngineerPaperSheetExtraction,
  type EngineerWorkflowAction,
} from "@/lib/engineer-workflow-store";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

export const runtime = "nodejs";

type PaperSheetRoutePayload = Extract<EngineerWorkflowAction, { action: "scan_paper_sheet" }>["payload"] & {
  images?: string[];
};

type EngineerWorkflowRouteAction = Exclude<EngineerWorkflowAction, { action: "scan_paper_sheet" }> | {
  action: "scan_paper_sheet";
  payload: PaperSheetRoutePayload;
};

function getOutputText(response: unknown) {
  if (response && typeof response === "object" && "output_text" in response && typeof response.output_text === "string") {
    return response.output_text.trim();
  }

  const output = response && typeof response === "object" && "output" in response ? response.output : null;
  if (!Array.isArray(output)) return "";

  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return [];
    return item.content.map((content: unknown) => (
      content && typeof content === "object" && "text" in content && typeof content.text === "string"
        ? content.text
        : ""
    ));
  }).filter(Boolean).join("\n").trim();
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normaliseAiExtraction(value: unknown): EngineerPaperSheetExtraction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const confidence = record.confidence === "High" || record.confidence === "Medium" || record.confidence === "Low"
    ? record.confidence
    : "Low";

  return {
    actualStart: typeof record.actualStart === "string" ? record.actualStart : undefined,
    actualEnd: typeof record.actualEnd === "string" ? record.actualEnd : undefined,
    breakMinutes: typeof record.breakMinutes === "number" ? record.breakMinutes : undefined,
    equipmentOut: asStringList(record.equipmentOut),
    equipmentIn: asStringList(record.equipmentIn),
    checklistDone: asStringList(record.checklistDone),
    notes: typeof record.notes === "string" ? record.notes : undefined,
    confidence,
  };
}

async function scanPaperSheetWithOpenAi(
  job: ReturnType<typeof getEngineerScheduleItem>,
  payload: PaperSheetRoutePayload,
) {
  const config = getTakeoffOpenAiConfig();
  const images = (payload.images ?? []).filter((image: string) => image.startsWith("data:image/")).slice(0, 3);
  if (!config.apiKey || !images.length) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text: "You read UK plumbing/heating engineer paper job sheets. Extract only what is visible. Do not guess. Return compact JSON.",
          }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Job: ${job?.jobRef ?? "unknown"} ${job?.customer ?? ""}`,
                `Scheduled: ${job?.start ?? ""}-${job?.end ?? ""}`,
                `Cost centre: ${job?.costCentre ?? ""}`,
                `Typed helper text: ${payload.sheetText ?? ""}`,
                "Return JSON with actualStart, actualEnd, breakMinutes, equipmentOut, equipmentIn, checklistDone, notes and confidence.",
              ].join("\n"),
            },
            ...images.map((image) => ({ type: "input_image" as const, image_url: image, detail: "high" as const })),
          ],
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const outputText = getOutputText(await response.json());
  if (!outputText) return null;

  try {
    return normaliseAiExtraction(JSON.parse(outputText));
  } catch {
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return normaliseAiExtraction(JSON.parse(jsonMatch[0]));
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const { scheduleId } = await params;
  const job = getEngineerScheduleItem(scheduleId);
  if (!job) {
    return NextResponse.json({ error: "Engineer job not found" }, { status: 404 });
  }

  return NextResponse.json(getEngineerJobWorkflow(scheduleId));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const { scheduleId } = await params;
  const job = getEngineerScheduleItem(scheduleId);
  if (!job) {
    return NextResponse.json({ error: "Engineer job not found" }, { status: 404 });
  }

  const payload = await parseJsonRequestBody<EngineerWorkflowRouteAction>(request);
  if (!payload?.action || !payload.payload) {
    return NextResponse.json({ error: "Choose an engineer workflow action." }, { status: 400 });
  }

  if (payload.action === "scan_paper_sheet") {
    const aiExtraction = await scanPaperSheetWithOpenAi(job, payload.payload).catch(() => null);
    return NextResponse.json(applyEngineerWorkflowAction(scheduleId, {
      action: "scan_paper_sheet",
      payload: {
        ...payload.payload,
        aiExtraction: aiExtraction ?? payload.payload.aiExtraction,
      },
    }));
  }

  return NextResponse.json(applyEngineerWorkflowAction(scheduleId, payload));
}
