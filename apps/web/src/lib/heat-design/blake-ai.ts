/**
 * Live OpenAI Blake for Heat Design — proposes kit, sizing guidance and clarifying questions.
 * Rule kit / sizing are the safety net when OpenAI is offline or returns unusable JSON.
 */

import { budgetPriceKitWithBlake } from "@/lib/blake-budget-prices";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

import { buildBlakeAncillariesKit, layoutCounts, type BlakeKitInput } from "./blake-kit";
import {
  applyBlakePipeSizing,
  summariseHeatingFittings,
  type HeatingFittingsSummary,
} from "./blake-route";
import { seedHeatingLayout } from "./layout";
import { heatingSystemOptions, type HeatingSystemKind } from "./systems";
import type {
  HeatDesignProject,
  HeatingEmitterMode,
  HeatingPipeDiameterMm,
  HeatingSystemLayout,
  KitLine,
} from "./types";

export type BlakeClarifyQuestion = {
  key: string;
  question: string;
  why: string;
};

export type BlakePipeSizeHint = {
  pipeId: string;
  diameterMm: HeatingPipeDiameterMm;
  reason: string;
};

export type BlakeHeatProposal = {
  summary: string;
  narrative: string;
  applySizing: boolean;
  /** When true, caller should seed/replace heatingLayout from rooms. */
  regenerateLayout: boolean;
  emitterMode?: HeatingEmitterMode;
  chosenSystemId?: string;
  layout?: HeatingSystemLayout;
  kitLines: KitLine[];
  clarifyingQuestions: BlakeClarifyQuestion[];
  routeNotes: string[];
  pipeSizes: BlakePipeSizeHint[];
  fittings?: HeatingFittingsSummary;
  aiUsed: boolean;
  connected: boolean;
  model?: string;
  error?: string;
  at: string;
};

function extractChatText(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content.trim() : "";
}

function slugId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function asDiameterMm(value: unknown): HeatingPipeDiameterMm | null {
  const n = Number(value);
  if (n === 15 || n === 22 || n === 28) return n;
  return null;
}

function normaliseKitLines(raw: unknown): KitLine[] {
  if (!Array.isArray(raw)) return [];
  const out: KitLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const description = String(item.description || "").trim();
    const qty = Number(item.qty ?? item.quantity);
    if (!description || !Number.isFinite(qty) || qty <= 0) continue;
    const category = String(item.category || "Ancillaries").trim() || "Ancillaries";
    const unitCost = Number(item.unitCost ?? item.unit_cost ?? 0);
    const unit = String(item.unit || "nr").trim() || "nr";
    const idSeed = String(item.id || description);
    out.push({
      id: `kit-blake-ai-${slugId(idSeed) || out.length}`,
      category,
      description,
      qty: Math.round(qty * 100) / 100,
      unitCost: Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : 0,
      unit,
      required: true,
    });
  }
  return out;
}

function normaliseQuestions(raw: unknown): BlakeClarifyQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: BlakeClarifyQuestion[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const question = String(item.question || "").trim();
    if (!question) continue;
    out.push({
      key: String(item.key || slugId(question) || `q-${out.length}`).trim(),
      question,
      why: String(item.why || "").trim() || "Affects materials or sizing.",
    });
  }
  return out.slice(0, 8);
}

function normalisePipeSizes(raw: unknown, layout?: HeatingSystemLayout | null): BlakePipeSizeHint[] {
  if (!Array.isArray(raw) || !layout?.pipes?.length) return [];
  const known = new Set(layout.pipes.map((p) => p.id));
  const out: BlakePipeSizeHint[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const pipeId = String(item.pipeId || item.id || "").trim();
    const diameterMm = asDiameterMm(item.diameterMm ?? item.diameter);
    if (!pipeId || !known.has(pipeId) || !diameterMm) continue;
    out.push({
      pipeId,
      diameterMm,
      reason: String(item.reason || "").trim() || "Blake AI size proposal",
    });
  }
  return out;
}

function normaliseNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => String(row || "").trim()).filter(Boolean).slice(0, 12);
}

function buildProjectContext(project: HeatDesignProject) {
  const system =
    heatingSystemOptions.find((item) => item.id === project.chosenSystemId) || null;
  const layout = project.heatingLayout;
  const counts = layoutCounts(layout);
  const fittings = layout?.pipes?.length ? summariseHeatingFittings(layout) : null;
  const rooms = (project.rooms || []).slice(0, 40).map((room) => ({
    id: room.id,
    name: room.name,
    type: room.roomType,
    length: room.length,
    width: room.width,
    height: room.height,
    floor: room.floorLevel,
    surveyedEmitters: (room.surveyedEmitters || []).map((e) => e.kind),
  }));
  return {
    name: project.name,
    customerName: project.customerName,
    address: [project.address, project.postcode].filter(Boolean).join(", "),
    propertyType: project.propertyType,
    buildEra: project.buildEra,
    occupants: project.occupants,
    currentFuel: project.currentFuel,
    flowTemperature: project.flowTemperature,
    designExternalTemp: project.designExternalTemp,
    cylinderLitres: project.cylinderLitres,
    dailyHotWaterLitres: project.dailyHotWaterLitres,
    emitterMode: project.emitterMode ?? layout?.emitterMode ?? "radiators",
    system: system
      ? { id: system.id, kind: system.kind, label: system.label }
      : { id: project.chosenSystemId || null, kind: null, label: null },
    roomCount: project.rooms.length,
    rooms,
    layout: layout
      ? {
          plants: layout.plants.map((p) => ({ id: p.id, kind: p.kind, label: p.label })),
          emitters: layout.emitters.map((e) => ({
            id: e.id,
            kind: e.kind,
            label: e.label,
            roomId: e.roomId,
          })),
          pipes: layout.pipes.map((p) => ({
            id: p.id,
            kind: p.kind,
            label: p.label,
            pointCount: p.points.length,
            diameterMm: p.diameterMm || null,
          })),
          counts,
        }
      : null,
    fittings,
    kitExtras: project.kitExtras || [],
  };
}

function ruleFallback(
  project: HeatDesignProject,
  opts: { connected: boolean; error?: string; summaryExtra?: string },
): BlakeHeatProposal {
  const systemKind =
    (heatingSystemOptions.find((item) => item.id === project.chosenSystemId)?.kind as
      | HeatingSystemKind
      | undefined) || "ashp";
  const layout = project.heatingLayout;
  const emitterMode = project.emitterMode ?? layout?.emitterMode ?? "radiators";
  const sized = layout?.pipes?.length ? applyBlakePipeSizing(layout) : layout;
  const fittings = sized?.pipes?.length ? summariseHeatingFittings(sized) : undefined;
  const kitInput: BlakeKitInput = {
    systemKind,
    emitterMode,
    layout: sized || layout,
    fittings,
    roomCount: project.rooms.length,
  };
  const kitLines = buildBlakeAncillariesKit(kitInput);
  const summary =
    opts.summaryExtra ||
    (opts.connected
      ? "OpenAI could not finish this pass — showing the rule kit so you can keep moving."
      : "OpenAI is not connected — showing the rule kit. Set OPENAI_API_KEY on this service for live Blake.");

  const needsLayout = !layout?.pipes?.length && (project.rooms?.length || 0) > 0;
  let seeded: HeatingSystemLayout | undefined;
  if (needsLayout && project.chosenSystemId) {
    seeded = seedHeatingLayout(project, project.chosenSystemId, emitterMode, {
      preservePlants: layout?.plants?.length ? layout.plants : project.heatingLayout?.plants,
    });
  }

  const plantNote = seeded?.plants?.length
    ? ` Plant on plan: ${seeded.plants.map((p) => p.label).join(", ")}.`
    : layout?.plants?.some((p) => p.placedByUser)
      ? " Engineer-placed plant kept — place missing pieces on plan if the kit still needs them."
      : "";

  return {
    summary,
    narrative:
      `Rule-based Blake draft: size mains 28 mm, branches 22 mm, tails 15 mm; include valves, TRVs, drains, clips and plant ancillaries from the layout.${plantNote}`,
    applySizing: Boolean(sized?.pipes?.length || seeded?.pipes?.length),
    regenerateLayout: Boolean(seeded),
    emitterMode,
    chosenSystemId: project.chosenSystemId,
    layout: seeded,
    kitLines,
    clarifyingQuestions: [],
    routeNotes: fittings?.notes || [
      "Design on plan, then Ask Blake again once OpenAI is connected for trade reasoning.",
    ],
    pipeSizes: [],
    fittings: seeded ? summariseHeatingFittings(seeded) : fittings,
    aiUsed: false,
    connected: opts.connected,
    error: opts.error,
    at: new Date().toISOString(),
  };
}

async function withBudgetPrices(
  project: HeatDesignProject,
  proposal: BlakeHeatProposal,
): Promise<BlakeHeatProposal> {
  const priced = await budgetPriceKitWithBlake(proposal.kitLines, {
    forceRefreshBudget: true,
    context: [
      project.name,
      project.customerName,
      project.chosenSystemId,
      project.emitterMode,
      `${project.rooms.length} rooms`,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  return {
    ...proposal,
    kitLines: priced.lines,
    narrative: priced.aiUsed
      ? `${proposal.narrative} Budget unit costs from live Blake (UK trade ballpark) — amend when supplier quotes land.`
      : proposal.narrative,
    aiUsed: proposal.aiUsed || priced.aiUsed,
    connected: proposal.connected || priced.connected,
    model: proposal.model || priced.model,
    error: proposal.error || priced.error,
  };
}

export function applyBlakePipeSizeHints(
  layout: HeatingSystemLayout,
  hints: BlakePipeSizeHint[],
): HeatingSystemLayout {
  if (!hints.length) return applyBlakePipeSizing(layout);
  const byId = new Map(hints.map((h) => [h.pipeId, h]));
  const sized = applyBlakePipeSizing(layout);
  return {
    ...sized,
    pipes: sized.pipes.map((pipe) => {
      const hint = byId.get(pipe.id);
      if (!hint) return pipe;
      return {
        ...pipe,
        diameterMm: hint.diameterMm,
        pipeSpecId: `copper-${hint.diameterMm}`,
        material: "copper",
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Ask live OpenAI Blake to propose Heat Design kit + route guidance for this project.
 * Always returns a usable proposal (AI or rule fallback).
 */
export async function proposeHeatDesignWithBlake(
  project: HeatDesignProject,
  options: { message?: string; regenerateLayout?: boolean } = {},
): Promise<BlakeHeatProposal> {
  const openAi = getTakeoffOpenAiConfig();
  if (!openAi.apiKey) {
    return withBudgetPrices(
      project,
      ruleFallback(project, {
        connected: false,
        error: "OpenAI key missing on this live service.",
      }),
    );
  }

  const context = buildProjectContext(project);
  const userMessage = String(options.message || "").trim();
  const wantsLayout =
    options.regenerateLayout === true
    || /redesign|re-?route|layout|place plant|design on plan/i.test(userMessage)
    || !project.heatingLayout?.pipes?.length;
  const prompt = [
    "You are Blake — NeXa’s UK heating design co-pilot (Gas Safe trade mindset).",
    "You are looking at a Heat Design project: rooms, chosen plant, emitters and pipe routes on plan.",
    "CRITICAL: If the engineer has already placed plant (boiler, cylinder, manifold, outdoor unit), KEEP ONLY those plant pieces when regenerateLayout is true — rebuild emitters and pipe routes around them. Do NOT invent extra plant they did not place.",
    "If plant is missing for a workable circuit, say so in clarifyingQuestions / routeNotes (e.g. place a cylinder) instead of silently adding it on plan.",
    "Propose a practical install kit and pipe-sizing guidance.",
    "Every kitLines item MUST include a UK trade BUDGET unitCost (ex VAT) — typical merchant ballpark for comparing to supplier quotes later. Never leave unitCost at 0 unless truly free.",
    "Prefer concrete merchant lines (TRVs, lockshields, isolation valves, AAVs, clips, lagging, zone valves, G3 bits, ASHP flex kits, etc.).",
    "NEVER collapse into ‘lot’, ‘allowance’ or ‘sundry’ — itemise.",
    "If the layout has pipes, set applySizing true and optionally override individual pipe diameters via pipeSizes[{pipeId,diameterMm:15|22|28,reason}].",
    "Default tiers when unsure: mains 28, branches 22, rad/UFH tails 15.",
    "If rooms exist but plant/pipes are missing — or the engineer asks to redesign — set regenerateLayout true and pick emitterMode (radiators|ufh|mixed) plus optional chosenSystemId (opt-ashp|opt-gas|opt-hybrid|opt-oil).",
    "Return clarifyingQuestions when site facts would change materials or sizes (cylinder location, existing TRVs, floor type for UFH, etc.). Skip if clear.",
    "Return JSON only with keys: summary, narrative, applySizing, regenerateLayout, emitterMode, chosenSystemId, kitLines, clarifyingQuestions, routeNotes, pipeSizes.",
    "kitLines items: {id?, category, description, qty, unit, unitCost}.",
    userMessage ? `Engineer note / question: ${userMessage}` : "Engineer wants Blake to propose the kit and size the routes.",
    wantsLayout ? "Prefer regenerateLayout when the plan has rooms but no useful pipe network yet." : "",
    JSON.stringify(context),
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAi.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAi.model || "gpt-4.1-mini",
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return strict JSON only. You are Blake proposing a heating design kit and pipe sizes for a UK plumber. Itemise materials. Ask clarifyingQuestions when unsure.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        typeof (body as { error?: { message?: string } }).error?.message === "string"
          ? (body as { error: { message: string } }).error.message
          : `OpenAI HTTP ${response.status}`;
      const shortDetail = /quota|billing/i.test(detail)
        ? "OpenAI quota or billing limit reached on this API key."
        : detail;
      return withBudgetPrices(
        project,
        ruleFallback(project, {
          connected: true,
          error: shortDetail,
          summaryExtra: `OpenAI is connected but Blake could not finish (${shortDetail}). Rule kit shown instead.`,
        }),
      );
    }

    const text = extractChatText(body);
    if (!text) {
      return withBudgetPrices(
        project,
        ruleFallback(project, {
          connected: true,
          error: "Empty OpenAI response",
          summaryExtra: "OpenAI returned an empty proposal. Rule kit shown instead.",
        }),
      );
    }

    const parsed = JSON.parse(text) as Record<string, unknown>;
    let kitLines = normaliseKitLines(parsed.kitLines ?? parsed.kit).map((line) => ({
      ...line,
      pricingSource: line.unitCost > 0 ? ("blake-budget" as const) : undefined,
      pricingNote:
        line.unitCost > 0
          ? "Blake budget (UK trade ballpark) — amend to supplier quote when uploaded"
          : undefined,
    }));
    if (!kitLines.length) {
      const fallback = await withBudgetPrices(
        project,
        ruleFallback(project, {
          connected: true,
          error: "No kit lines in OpenAI JSON",
        }),
      );
      kitLines = fallback.kitLines;
    }

    const emitterRaw = String(parsed.emitterMode || "");
    const emitterMode: HeatingEmitterMode | undefined =
      emitterRaw === "ufh" || emitterRaw === "mixed" || emitterRaw === "radiators"
        ? emitterRaw
        : undefined;
    const systemRaw = String(parsed.chosenSystemId || "");
    const chosenSystemId =
      systemRaw === "opt-ashp" || systemRaw === "opt-gas" || systemRaw === "opt-hybrid" || systemRaw === "opt-oil"
        ? systemRaw
        : project.chosenSystemId;

    const regenerateLayout =
      parsed.regenerateLayout === true
      || (wantsLayout && !project.heatingLayout?.pipes?.length && (project.rooms?.length || 0) > 0);

    let layout: HeatingSystemLayout | undefined;
    if (regenerateLayout && chosenSystemId) {
      layout = seedHeatingLayout(
        { ...project, chosenSystemId, emitterMode: emitterMode || project.emitterMode },
        chosenSystemId,
        emitterMode || project.emitterMode || "radiators",
        {
          preservePlants: project.heatingLayout?.plants,
        },
      );
    }

    const workingLayout = layout || project.heatingLayout;
    const pipeSizes = normalisePipeSizes(parsed.pipeSizes, workingLayout);
    const applySizing =
      parsed.applySizing === false
        ? false
        : Boolean(workingLayout?.pipes?.length) || pipeSizes.length > 0 || regenerateLayout;

    let fittings: HeatingFittingsSummary | undefined;
    if (applySizing && workingLayout?.pipes?.length) {
      const sized = applyBlakePipeSizeHints(workingLayout, pipeSizes);
      layout = sized;
      fittings = summariseHeatingFittings(sized);
    }

    return withBudgetPrices(project, {
      summary:
        String(parsed.summary || "").trim() ||
        `Blake proposes ${kitLines.length} kit line${kitLines.length === 1 ? "" : "s"} for this design.`,
      narrative:
        String(parsed.narrative || parsed.reasoning || "").trim() ||
        "Blake sized the network and itemised valves, emitter packs and plant bits for Takeoff / Core.",
      applySizing,
      regenerateLayout,
      emitterMode,
      chosenSystemId,
      layout,
      kitLines,
      clarifyingQuestions: normaliseQuestions(parsed.clarifyingQuestions),
      routeNotes: normaliseNotes(parsed.routeNotes),
      pipeSizes,
      fittings,
      aiUsed: true,
      connected: true,
      model: openAi.model,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return withBudgetPrices(
      project,
      ruleFallback(project, {
        connected: true,
        error: err instanceof Error ? err.message : "OpenAI request failed",
        summaryExtra: "Blake hit a network error talking to OpenAI. Rule kit shown instead.",
      }),
    );
  }
}
