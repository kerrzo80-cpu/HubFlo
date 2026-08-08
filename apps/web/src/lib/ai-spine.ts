/**
 * NeXa AI spine — one handoff that opens the linked design / takeoff / quote path
 * from a short brief (survey → heat → takeoff → Core).
 */

import { makeBlankProject } from "@/lib/heat-design/catalogue";
import { seedHeatingLayout } from "@/lib/heat-design/layout";
import type { HeatingEmitterMode, HeatDesignProject } from "@/lib/heat-design/types";
import { createHeatDesignProject, saveHeatDesignProject } from "@/lib/heat-design-store";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import { createTakeoffProject } from "@/lib/takeoff-data";

export type AiSpineBrief = {
  customerName?: string;
  siteAddress?: string;
  postcode?: string;
  jobType?: string;
  notes?: string;
  /** Prefer ASHP vs gas when AI/rules pick a system. */
  preferAshp?: boolean;
  emitterMode?: HeatingEmitterMode;
  linkedQuoteId?: string;
  linkedQuoteRef?: string;
  linkedJobId?: string;
  linkedJobRef?: string;
};

export type AiSpineStep = {
  id: string;
  label: string;
  href: string;
  status: "ready" | "next" | "optional";
  detail: string;
};

export type AiSpineResult = {
  ok: true;
  summary: string;
  narrative: string;
  aiUsed: boolean;
  connected: boolean;
  model?: string;
  error?: string;
  heatDesign: { id: string; name: string };
  takeoff: { id: string; reference: string; name: string };
  steps: AiSpineStep[];
  clarifyingQuestions: string[];
};

function extractChatText(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content.trim() : "";
}

type SpinePlan = {
  systemOptionId: "opt-ashp" | "opt-gas" | "opt-hybrid" | "opt-oil";
  emitterMode: HeatingEmitterMode;
  summary: string;
  narrative: string;
  clarifyingQuestions: string[];
  aiUsed: boolean;
  connected: boolean;
  model?: string;
  error?: string;
};

function rulePlan(brief: AiSpineBrief): SpinePlan {
  const text = `${brief.jobType || ""} ${brief.notes || ""}`.toLowerCase();
  const preferAshp =
    brief.preferAshp === true
    || /\bashp\b|heat.?pump|air.?source/.test(text);
  const hybrid = /\bhybrid\b/.test(text);
  const oil = /\boil\b/.test(text);
  const ufh = /\bufh\b|underfloor/.test(text);
  const mixed = ufh && /\brad/.test(text);
  return {
    systemOptionId: hybrid ? "opt-hybrid" : preferAshp ? "opt-ashp" : oil ? "opt-oil" : "opt-gas",
    emitterMode: brief.emitterMode || (mixed ? "mixed" : ufh ? "ufh" : "radiators"),
    summary: "Spine opened from brief (rule plan).",
    narrative:
      "Created linked Heat Design + Takeoff from the brief. Draw rooms / upload drawings, Ask Blake, then Push to quote.",
    clarifyingQuestions: [
      "Confirm plant type and flow temperature on Heat Design.",
      "Upload the floor plan PDF into Takeoff and set scale.",
    ],
    aiUsed: false,
    connected: getTakeoffOpenAiConfig().connected,
  };
}

async function planSpineWithAi(brief: AiSpineBrief): Promise<SpinePlan> {
  const openAi = getTakeoffOpenAiConfig();
  if (!openAi.apiKey) {
    return { ...rulePlan(brief), error: "OpenAI key missing — rule plan used." };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAi.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAi.model || "gpt-4.1-mini",
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return JSON only. You are Blake planning a UK heating job handoff across Heat Design and Takeoff.",
          },
          {
            role: "user",
            content: [
              "From this brief pick systemOptionId (opt-ashp|opt-gas|opt-hybrid|opt-oil),",
              "emitterMode (radiators|ufh|mixed), summary, narrative, clarifyingQuestions[string].",
              JSON.stringify(brief),
            ].join("\n"),
          },
        ],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        typeof (body as { error?: { message?: string } }).error?.message === "string"
          ? (body as { error: { message: string } }).error.message
          : `OpenAI HTTP ${response.status}`;
      return { ...rulePlan(brief), connected: true, error: detail };
    }
    const text = extractChatText(body);
    if (!text) {
      return { ...rulePlan(brief), connected: true, error: "Empty OpenAI response" };
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const systemRaw = String(parsed.systemOptionId || "");
    const systemOptionId =
      systemRaw === "opt-ashp" || systemRaw === "opt-hybrid" || systemRaw === "opt-oil" || systemRaw === "opt-gas"
        ? systemRaw
        : rulePlan(brief).systemOptionId;
    const emitterRaw = String(parsed.emitterMode || "");
    const emitterMode: HeatingEmitterMode =
      emitterRaw === "ufh" || emitterRaw === "mixed" || emitterRaw === "radiators"
        ? emitterRaw
        : brief.emitterMode || "radiators";
    const clarifyingQuestions = Array.isArray(parsed.clarifyingQuestions)
      ? parsed.clarifyingQuestions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 8)
      : [];

    return {
      systemOptionId,
      emitterMode,
      summary: String(parsed.summary || "").trim() || "Blake opened the job spine.",
      narrative:
        String(parsed.narrative || "").trim()
        || "Linked Heat Design and Takeoff are ready — continue the steps Blake listed.",
      clarifyingQuestions,
      aiUsed: true,
      connected: true,
      model: openAi.model,
    };
  } catch (err) {
    return {
      ...rulePlan(brief),
      connected: true,
      error: err instanceof Error ? err.message : "OpenAI failed",
    };
  }
}

/** Create linked Heat Design + Takeoff and return ordered next steps. */
export async function runAiSpine(brief: AiSpineBrief): Promise<AiSpineResult> {
  const plan = await planSpineWithAi(brief);
  const customer = brief.customerName?.trim() || "Customer to confirm";
  const site = [brief.siteAddress, brief.postcode].filter(Boolean).join(", ") || "Site to confirm";
  const jobLabel = brief.jobType?.trim() || "Heating design";

  const blank = makeBlankProject();
  let heat: HeatDesignProject = createHeatDesignProject({
    ...blank,
    id: `hd-spine-${Date.now().toString(36)}`,
    name: `${customer} · ${jobLabel}`,
    customerName: customer,
    address: brief.siteAddress?.trim() || "",
    postcode: brief.postcode?.trim() || "",
    chosenSystemId: plan.systemOptionId,
    emitterMode: plan.emitterMode,
    reportOptionIds: ["opt-ashp", "opt-gas", "opt-hybrid", "opt-oil"],
    linkedQuoteId: brief.linkedQuoteId,
    linkedQuoteRef: brief.linkedQuoteRef,
    linkedJobId: brief.linkedJobId,
    linkedJobRef: brief.linkedJobRef,
  });

  // Seed a starter layout so Ask Blake / Send to Takeoff have plant context even before rooms.
  const layout = seedHeatingLayout(heat, plan.systemOptionId, plan.emitterMode);
  heat = saveHeatDesignProject({
    ...heat,
    heatingLayout: layout,
    updatedAt: new Date().toISOString(),
  });

  const takeoff = createTakeoffProject({
    name: `${customer} · heating takeoff`,
    customer,
    site,
    description: [
      brief.notes?.trim() || jobLabel,
      `Spine from Heat Design ${heat.id}`,
      plan.narrative,
    ]
      .filter(Boolean)
      .join("\n"),
    linkedQuoteId: brief.linkedQuoteId,
    linkedQuoteRef: brief.linkedQuoteRef,
    linkedJobId: brief.linkedJobId,
    linkedJobRef: brief.linkedJobRef,
    status: "Draft",
  });

  heat = saveHeatDesignProject({
    ...heat,
    linkedTakeoffId: takeoff.id,
    linkedTakeoffRef: takeoff.reference,
    updatedAt: new Date().toISOString(),
  });

  const steps: AiSpineStep[] = [
    {
      id: "heat",
      label: "Heat Design — rooms & Ask Blake",
      href: `/heat-design?projectId=${encodeURIComponent(heat.id)}`,
      status: "next",
      detail: "Draw/survey rooms, confirm system, Ask Blake for kit + sizes.",
    },
    {
      id: "takeoff",
      label: "Takeoff — upload drawing & measure",
      href: `/takeoff?projectId=${encodeURIComponent(takeoff.id)}`,
      status: "ready",
      detail: "Upload PDF, set scale, Ask Blake / Propose, then Push.",
    },
    {
      id: "survey",
      label: "Survey pack (optional)",
      href: `/survey`,
      status: "optional",
      detail: "If you have site evidence, run Quick pack for RFQ materials.",
    },
    {
      id: "quote",
      label: brief.linkedQuoteRef ? `Open quote ${brief.linkedQuoteRef}` : "Link / create quote in Core",
      href: brief.linkedQuoteId ? `/?module=quotes&quoteId=${encodeURIComponent(brief.linkedQuoteId)}` : "/?module=quotes",
      status: brief.linkedQuoteId ? "ready" : "optional",
      detail: "Push Takeoff BOQ or Heat kit into the Core quote when ready.",
    },
  ];

  return {
    ok: true,
    summary: plan.summary,
    narrative: plan.narrative,
    aiUsed: plan.aiUsed,
    connected: plan.connected,
    model: plan.model,
    error: plan.error,
    heatDesign: { id: heat.id, name: heat.name },
    takeoff: { id: takeoff.id, reference: takeoff.reference, name: takeoff.name },
    steps,
    clarifyingQuestions: plan.clarifyingQuestions,
  };
}
