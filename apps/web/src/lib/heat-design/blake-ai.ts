/**
 * Live OpenAI Blake for Heat Design — designs visible pipe routes + kit.
 * Rule seed (`ensureDesignLayout`) always draws a coherent network when plant
 * and/or rooms exist; OpenAI adds trade reasoning, emitter choice, kit + notes.
 * Never leave Ask Blake as “kit-only branding” over empty geometry.
 */

import { budgetPriceKitWithBlake } from "@/lib/blake-budget-prices";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

import { buildBlakeAncillariesKit, layoutCounts, type BlakeKitInput } from "./blake-kit";
import {
  applyBlakePipeSizing,
  summariseHeatingFittings,
  type HeatingFittingsSummary,
} from "./blake-route";
import { describeHeatingLayoutNotes, ensureDesignLayout } from "./layout";
import { isUfhCircuitPipe } from "./pipe-sizing";
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
  if (n === 15 || n === 16 || n === 22 || n === 28) return n;
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

function mergeUniqueNotes(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const note of group || []) {
      const key = note.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(note.trim());
    }
  }
  return out.slice(0, 14);
}

function resolveSystemId(project: HeatDesignProject, preferred?: string | null) {
  if (preferred && heatingSystemOptions.some((item) => item.id === preferred)) return preferred;
  return (
    project.chosenSystemId
    || project.heatingLayout?.systemOptionId
    || project.reportOptionIds?.[0]
    || "opt-ashp"
  );
}

function wantsDesignPass(
  project: HeatDesignProject,
  options: { message?: string; regenerateLayout?: boolean },
) {
  const userMessage = String(options.message || "").trim();
  if (/kit only|size only|no route|don't redesign|do not redesign/i.test(userMessage)) {
    return false;
  }
  if (options.regenerateLayout === true) return true;
  if (/redesign|re-?route|layout|place plant|design on plan|draw|route/i.test(userMessage)) {
    return true;
  }
  const hasPlant = (project.heatingLayout?.plants?.length || 0) > 0;
  const hasRooms = (project.rooms?.length || 0) > 0;
  const emptyPipes = !(project.heatingLayout?.pipes?.length);
  // Ask Blake's main job is design — always redesign when plant/rooms exist unless kit-only.
  if (hasPlant || hasRooms) return true;
  return emptyPipes;
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
    planX: room.planX,
    planY: room.planY,
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
          plants: layout.plants.map((p) => ({
            id: p.id,
            kind: p.kind,
            label: p.label,
            x: Math.round(p.x * 100) / 100,
            y: Math.round(p.y * 100) / 100,
            floor: p.floorLevel,
            placedByUser: Boolean(p.placedByUser),
          })),
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

function seedAndSize(
  project: HeatDesignProject,
  opts: { emitterMode?: HeatingEmitterMode; chosenSystemId?: string },
): { layout?: HeatingSystemLayout; fittings?: HeatingFittingsSummary } {
  const chosenSystemId = resolveSystemId(project, opts.chosenSystemId);
  const emitterMode = opts.emitterMode || project.emitterMode || "radiators";
  const seeded = ensureDesignLayout(
    { ...project, chosenSystemId, emitterMode },
    {
      systemOptionId: chosenSystemId,
      emitterMode,
      preservePlants: project.heatingLayout?.plants,
    },
  );
  if (!seeded?.pipes?.length && !seeded?.plants?.length) {
    return { layout: seeded || undefined };
  }
  const sized = seeded.pipes.length ? applyBlakePipeSizing(seeded) : seeded;
  return {
    layout: sized,
    fittings: sized.pipes.length ? summariseHeatingFittings(sized) : undefined,
  };
}

function ruleFallback(
  project: HeatDesignProject,
  opts: {
    connected: boolean;
    error?: string;
    summaryExtra?: string;
    forceDesign?: boolean;
    emitterMode?: HeatingEmitterMode;
    chosenSystemId?: string;
  },
): BlakeHeatProposal {
  const chosenSystemId = resolveSystemId(project, opts.chosenSystemId);
  const systemKind =
    (heatingSystemOptions.find((item) => item.id === chosenSystemId)?.kind as
      | HeatingSystemKind
      | undefined) || "ashp";
  const emitterMode =
    opts.emitterMode || project.emitterMode || project.heatingLayout?.emitterMode || "radiators";
  const shouldDesign =
    opts.forceDesign !== false
    && (
      (project.heatingLayout?.plants?.length || 0) > 0
      || (project.rooms?.length || 0) > 0
      || !(project.heatingLayout?.pipes?.length)
    );

  const designed = shouldDesign
    ? seedAndSize(
        { ...project, chosenSystemId, emitterMode },
        { chosenSystemId, emitterMode },
      )
    : {
        layout: project.heatingLayout?.pipes?.length
          ? applyBlakePipeSizing(project.heatingLayout)
          : project.heatingLayout || undefined,
        fittings: undefined as HeatingFittingsSummary | undefined,
      };

  const layout = designed.layout;
  const fittings =
    designed.fittings
    || (layout?.pipes?.length ? summariseHeatingFittings(layout) : undefined);

  const kitInput: BlakeKitInput = {
    systemKind,
    emitterMode,
    layout,
    fittings,
    roomCount: project.rooms.length,
  };
  const kitLines = buildBlakeAncillariesKit(kitInput);
  const geoNotes = describeHeatingLayoutNotes(layout);
  const pipeCount = layout?.pipes?.length || 0;
  const summary =
    opts.summaryExtra
    || (pipeCount
      ? `Rule design · ${pipeCount} pipe run${pipeCount === 1 ? "" : "s"} · ${kitLines.length} kit lines.`
      : opts.connected
        ? "OpenAI could not finish this pass — rule kit only (no plant/rooms to route)."
        : "OpenAI is not connected — rule kit. Place plant or rooms for Blake to draw routes.");

  return {
    summary,
    narrative:
      pipeCount
        ? `Blake (rules) drew plant-connected primaries and ${emitterMode} emitters where rooms exist, then sized 28/22/15 mm and itemised valves, TRVs, drains and clips. Geometric draft only — not MCS/hydraulics certificate.`
        : "No layout could be drawn — place boiler / cylinder / manifold on plan (or draw rooms), then Ask Blake again.",
    applySizing: Boolean(layout?.pipes?.length),
    regenerateLayout: Boolean(layout && shouldDesign),
    emitterMode,
    chosenSystemId,
    layout: shouldDesign ? layout : undefined,
    kitLines,
    clarifyingQuestions: [],
    routeNotes: mergeUniqueNotes(
      geoNotes,
      fittings?.notes,
      opts.connected
        ? undefined
        : ["Set OPENAI_API_KEY on this service for live Blake trade reasoning."],
    ),
    pipeSizes: [],
    fittings,
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
      `${proposal.layout?.pipes?.length || project.heatingLayout?.pipes?.length || 0} pipes`,
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
      // Never rewrite UFH circuit pipe to copper via AI diameter hints.
      if (isUfhCircuitPipe(pipe) || /ufh\s*(loop|tail)/i.test(pipe.label)) {
        return {
          ...pipe,
          diameterMm: 16,
          pipeSpecId: "pex-16",
          material: "PEX",
        };
      }
      return {
        ...pipe,
        diameterMm: hint.diameterMm,
        pipeSpecId: hint.diameterMm === 16 ? "pex-16" : `cu-${hint.diameterMm}`,
        material: hint.diameterMm === 16 ? "PEX" : "Copper",
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Ask live OpenAI Blake to design routes (via rule geometry + AI reasoning) and kit.
 * Always returns a usable proposal (AI or rule fallback). When plant/rooms exist,
 * layout is regenerated so the plan is never left empty after Ask Blake.
 */
export async function proposeHeatDesignWithBlake(
  project: HeatDesignProject,
  options: { message?: string; regenerateLayout?: boolean } = {},
): Promise<BlakeHeatProposal> {
  const designPass = wantsDesignPass(project, options);
  const openAi = getTakeoffOpenAiConfig();
  if (!openAi.apiKey) {
    return withBudgetPrices(
      project,
      ruleFallback(project, {
        connected: false,
        error: "OpenAI key missing on this live service.",
        forceDesign: designPass,
      }),
    );
  }

  // Seed geometry first so AI reasons over a real network, not empty plant icons.
  const preSystemId = resolveSystemId(project);
  const preEmitter = project.emitterMode || project.heatingLayout?.emitterMode || "radiators";
  const draft = designPass
    ? seedAndSize(
        { ...project, chosenSystemId: preSystemId, emitterMode: preEmitter },
        { chosenSystemId: preSystemId, emitterMode: preEmitter },
      )
    : { layout: project.heatingLayout || undefined, fittings: undefined };
  const draftProject: HeatDesignProject = {
    ...project,
    chosenSystemId: preSystemId,
    emitterMode: preEmitter,
    heatingLayout: draft.layout || project.heatingLayout,
  };

  const context = buildProjectContext(draftProject);
  const userMessage = String(options.message || "").trim();
  const prompt = [
    "You are Blake — NeXa’s UK heating design co-pilot (Gas Safe trade mindset).",
    "The engineer placed plant (and optionally rooms) on a Heat Design plan. A geometric draft network is already in context.layout — study plant x/y and rooms.",
    "Your job: THINK about this install, then return trade reasoning + kit. Do NOT invent plant pieces they did not place.",
    "Explain what you would connect (boiler↔cylinder↔manifolds, flow/return legs, emitter branches) in routeNotes and narrative.",
    "Pick emitterMode (radiators|ufh|mixed) if rooms exist. Keep regenerateLayout true whenever plant or rooms are present so the UI redraws.",
    "Propose a practical install kit with BUDGET unitCost (ex VAT) on every line — never leave 0 unless free. Itemise; no ‘lot’/‘sundry’.",
    "If the layout has pipes, set applySizing true and optionally override diameters via pipeSizes[{pipeId,diameterMm:15|22|28,reason}] for copper primary/radiator runs only.",
    "Default tiers: copper mains 28, branches 22, rad tails 15. UFH loops and manifold tails are ALWAYS 16mm PEX — never copper.",
    "Return clarifyingQuestions when site facts would change materials (existing TRVs, floor type for UFH, cylinder location). Skip if clear.",
    "Return JSON only with keys: summary, narrative, applySizing, regenerateLayout, emitterMode, chosenSystemId, kitLines, clarifyingQuestions, routeNotes, pipeSizes, assumptions.",
    "assumptions: short string array of design assumptions you made.",
    "kitLines items: {id?, category, description, qty, unit, unitCost}.",
    userMessage ? `Engineer note / question: ${userMessage}` : "Engineer wants Blake to design the heating layout on plan and propose the kit.",
    designPass
      ? "MUST set regenerateLayout true — engineer expects visible pipes after Ask Blake."
      : "Kit/sizing pass only — do not insist on redesign.",
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
              "Return strict JSON only. You are Blake designing a UK heating layout: reason about plant connections and emitters, then kit. Be concrete. Ask clarifyingQuestions when unsure.",
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
          forceDesign: designPass,
          summaryExtra: `OpenAI connected but Blake could not finish (${shortDetail}). Rule design + kit shown instead.`,
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
          forceDesign: designPass,
          summaryExtra: "OpenAI returned empty — rule design + kit shown instead.",
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

    const emitterRaw = String(parsed.emitterMode || "");
    const emitterMode: HeatingEmitterMode | undefined =
      emitterRaw === "ufh" || emitterRaw === "mixed" || emitterRaw === "radiators"
        ? emitterRaw
        : undefined;
    const chosenSystemId = resolveSystemId(project, String(parsed.chosenSystemId || "") || null);

    // Always redraw when this is a design pass — never trust AI to skip geometry.
    const regenerateLayout = designPass || parsed.regenerateLayout === true;

    let layout: HeatingSystemLayout | undefined;
    let fittings: HeatingFittingsSummary | undefined;
    if (regenerateLayout) {
      const redesigned = seedAndSize(
        { ...project, chosenSystemId, emitterMode: emitterMode || project.emitterMode },
        { chosenSystemId, emitterMode: emitterMode || project.emitterMode || "radiators" },
      );
      layout = redesigned.layout;
      fittings = redesigned.fittings;
    } else {
      layout = draft.layout || project.heatingLayout || undefined;
    }

    if (!kitLines.length) {
      const fallbackKit = buildBlakeAncillariesKit({
        systemKind:
          (heatingSystemOptions.find((item) => item.id === chosenSystemId)?.kind as HeatingSystemKind)
          || "ashp",
        emitterMode: emitterMode || project.emitterMode || "radiators",
        layout,
        fittings,
        roomCount: project.rooms.length,
      });
      kitLines = fallbackKit;
    }

    const workingLayout = layout || project.heatingLayout;
    const pipeSizes = normalisePipeSizes(parsed.pipeSizes, workingLayout);
    const applySizing =
      parsed.applySizing === false
        ? false
        : Boolean(workingLayout?.pipes?.length) || pipeSizes.length > 0 || regenerateLayout;

    if (applySizing && workingLayout?.pipes?.length) {
      const sized = applyBlakePipeSizeHints(workingLayout, pipeSizes);
      layout = sized;
      fittings = summariseHeatingFittings(sized);
    }

    const geoNotes = describeHeatingLayoutNotes(layout);
    const aiNotes = normaliseNotes(parsed.routeNotes);
    const assumptions = normaliseNotes(parsed.assumptions);
    const pipeCount = layout?.pipes?.length || 0;

    return withBudgetPrices(project, {
      summary:
        String(parsed.summary || "").trim()
        || (pipeCount
          ? `Blake designed ${pipeCount} pipe runs and ${kitLines.length} kit lines.`
          : `Blake proposes ${kitLines.length} kit line${kitLines.length === 1 ? "" : "s"}.`),
      narrative:
        String(parsed.narrative || parsed.reasoning || "").trim()
        || "Blake reasoned about plant connections, drew the geometric network, sized pipes and itemised the kit.",
      applySizing,
      regenerateLayout,
      emitterMode,
      chosenSystemId,
      layout,
      kitLines,
      clarifyingQuestions: normaliseQuestions(parsed.clarifyingQuestions),
      routeNotes: mergeUniqueNotes(
        aiNotes,
        assumptions.map((row) => (row.startsWith("Assumption") ? row : `Assumption: ${row}`)),
        geoNotes,
        fittings?.notes,
      ),
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
        forceDesign: designPass,
        summaryExtra: "Blake hit a network error talking to OpenAI. Rule design + kit shown instead.",
      }),
    );
  }
}
