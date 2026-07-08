import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffProject,
  type TakeoffSurveyChatMessage,
} from "@/lib/takeoff-data";

export const runtime = "nodejs";

type SurveyChatPayload = {
  message?: string;
};

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

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

function documentSummary(project: TakeoffProject) {
  const counts = project.documents.reduce<Record<string, number>>((summary, document) => {
    summary[document.kind] = (summary[document.kind] ?? 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts).map(([kind, count]) => `${kind}: ${count}`).join(", ") || "No evidence uploaded yet";
}

function projectContext(project: TakeoffProject) {
  return [
    `Project ref: ${project.reference}`,
    `Project name: ${project.name}`,
    `Customer: ${project.customer}`,
    `Site: ${project.site}`,
    `Linked quote: ${project.linkedQuoteRef || project.linkedQuoteId || "not linked"}`,
    `Current scope/description: ${project.description}`,
    `Evidence: ${documentSummary(project)}`,
    `Heat-loss rooms: ${project.rooms.filter((room) => room.heatLoadWatts).length}`,
    `Radiators: ${project.radiators.length}`,
    `Material allowances: ${project.materialAllowances.length}`,
    `Labour allowances: ${project.labourAllowances.length}`,
    `Supplier request lines: ${project.supplierRequests.length}`,
  ].join("\n");
}

function recentTranscript(messages: TakeoffSurveyChatMessage[]) {
  return messages.slice(-18).map((message) => (
    `${message.role === "assistant" ? "NeXa" : "User"}: ${message.text}`
  )).join("\n");
}

function previousAssistantAsked(project: TakeoffProject, phrase: string) {
  const lowerPhrase = phrase.toLowerCase();
  return (project.surveyChat ?? []).some((message) => (
    message.role === "assistant" && message.text.toLowerCase().includes(lowerPhrase)
  ));
}

type PilotEstimateProfile = {
  label: string;
  costCentres: string[];
  materials: string[];
  labour: string[];
  assumptions: string[];
  questions: string[];
  supplierItems: string[];
};

function uniqueLines(lines: string[]) {
  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
}

function bulletList(lines: string[]) {
  return uniqueLines(lines).map((line) => `- ${line}`).join("\n");
}

function buildScopeLine(project: TakeoffProject, message: string) {
  const cleanMessage = message.trim();
  if (cleanMessage) return cleanMessage;
  if (project.description && project.description !== "Takeoff scope to review.") return project.description;
  return "Scope to confirm from survey notes";
}

function isShowerOnlyScope(text: string) {
  const hasShowerScope = /shower|cubicle|enclosure|tray|screen|bi[- ]?fold|bifold/.test(text);
  const explicitShowerOnly =
    /shower\s+only|only\s+(?:the\s+)?shower|shower\s+cubicle|shower\s+enclosure/.test(text) ||
    /no\s+(?:basin|toilet|wc)|not\s+(?:moving|pricing|supplying|including).*(?:basin|toilet|wc)/.test(text);
  const widerBathroomSignals =
    /toilet|wc|basin|vanity|bath(?!room)|suite|sanitaryware|move\s+(?:the\s+)?(?:toilet|basin)|soil\s+route|full\s+bathroom|bathroom\s+(?:refurb|refurbishment|renovation)/.test(
      text,
    );

  return hasShowerScope && (explicitShowerOnly || !widerBathroomSignals);
}

function estimateProfileFor(project: TakeoffProject, message: string): PilotEstimateProfile {
  const lower = `${project.name} ${project.description} ${message}`.toLowerCase();
  const profile: PilotEstimateProfile = {
    label: "General plumbing / building works",
    costCentres: [
      "Survey and set-out",
      "Materials and plant",
      "Labour installation",
      "Testing, commissioning and handover",
    ],
    materials: [
      "Consumables, fittings and sundries to match the final scope",
      "Making-good materials where finishes are disturbed",
      "Waste removal or skip allowance if strip-out is included",
    ],
    labour: [
      "Engineer labour for first fix, second fix and testing",
      "Office review time to convert this into a clean client quote",
    ],
    assumptions: [
      "Prices should stay provisional until supplier items and site access are confirmed",
      "Client-visible description should be kept separate from internal costing notes",
    ],
    questions: [
      "What finishes or making-good are included?",
      "Which materials need supplier prices before issue?",
      "Is this fixed price, daywork or allowance-led?",
    ],
    supplierItems: [
      "Any named fixture, valve, appliance or specialist material with volatile pricing",
    ],
  };

  if (isShowerOnlyScope(lower)) {
    profile.label = "Shower cubicle works";
    profile.costCentres = [
      "Strip out existing shower cubicle",
      "Shower feed and waste alterations",
      "Shower tray, cubicle or screen where included",
      "Local making good, seal and test",
    ];
    profile.materials = [
      "Shower tray/cubicle/screen and shower waste if supplied by us",
      "Isolation valves, caps, pipework and waste fittings local to the shower area",
      "Sealants, fixings and local waterproofing/making-good sundries",
      "Wall panels, tiling, flooring and electrics only if expressly included",
    ];
    profile.labour = [
      "Plumber strip-out/isolation time for the existing shower only",
      "Plumber first fix for shower feed and waste alterations",
      "Plumber second fix, seal, test and handover",
      "Joinery/tiling/electrical labour only where included",
    ];
    profile.assumptions = [
      "No basin, WC, toilet or wider sanitaryware works included unless specifically added",
      "Shower tray/cubicle/screen may need supplier pricing before issue",
      "Wall/floor condition behind the existing cubicle is provisional until strip-out",
      "Decorating, flooring, tiling and wall panels remain excluded unless clearly included",
    ];
    profile.questions = [
      "Are we supplying the shower tray/cubicle/screen and waste, or is the customer supplying?",
      "Are wall panels, tiling, flooring, electrics and decorating included or excluded?",
      "Is the shower waste staying in the same location or moving?",
    ];
    profile.supplierItems = [
      "Shower tray and cubicle/screen",
      "Shower waste/trap and local fittings",
      "Shower valve/set only if included",
    ];
  } else if (/bathroom|toilet|basin|shower|cubicle|suite|wc|sanitary|tile|tiling/.test(lower)) {
    profile.label = "Bathroom refurbishment";
    profile.costCentres = [
      "Strip out and isolate existing services",
      "Move waste, soil, hot and cold pipework",
      "First fix plumbing and shower valve route",
      "Wall/floor preparation and making good",
      "Second fix sanitaryware, shower enclosure and testing",
    ];
    profile.materials = [
      "Skip or waste disposal allowance",
      "Pipework, isolation valves, waste fittings and soil fittings",
      "Shower tray/cubicle, basin, taps, WC and wastes if supplied by us",
      "Boarding, sealants, fixings and access panel allowance",
      "Tiling/electrical/extraction items only if included in our scope",
    ];
    profile.labour = [
      "Plumber strip-out/isolation time",
      "Plumber first fix for moved services",
      "Plumber second fix and test",
      "Joinery/tiling/electrical labour only where included",
    ];
    profile.assumptions = [
      "Allow extra risk if the toilet moves away from the existing soil route",
      "Assume hidden pipe routes and floor condition are provisional until opened",
      "Exclude decorating and final finishes unless clearly included",
      "Supplier quote required for sanitaryware, shower enclosure and any client-selected finishes",
    ];
    profile.questions = [
      "Is the toilet moving onto the same soil wall or a new route?",
      "Are we supplying the suite/shower screen/tray, or is the customer supplying?",
      "Are tiling, electrics, joinery boxing and decorating included or excluded?",
    ];
    profile.supplierItems = [
      "Shower tray and cubicle/screen",
      "Basin, tap, waste and vanity if applicable",
      "WC pan/cistern/seat and frame if concealed",
      "Tiles, boards and trims if included",
    ];
  }

  if (/boiler|heating|radiator|heat loss|cylinder|flue|controls|thermostat/.test(lower)) {
    profile.label = /radiator|heat loss/.test(lower) ? "Heating and radiator works" : "Boiler / heating works";
    profile.costCentres = [
      "Survey, heat loss and radiator schedule",
      "Plant, boiler/radiator and controls supply",
      "Pipework alterations and access works",
      "Installation, flushing, testing and commissioning",
      "Gas paperwork and handover evidence",
    ];
    profile.materials = [
      "Boiler/radiators/valves/controls to supplier quote",
      "Copper/plastic pipework, fittings, insulation and clips",
      "Flue, plume kit and condensate materials where required",
      "Chemical cleaner/inhibitor and test consumables",
    ];
    profile.labour = [
      "Heating engineer survey and set-out",
      "Engineer installation hours split by plant, pipework and commissioning",
      "Allowance for draining, filling, balancing and customer handover",
    ];
    profile.assumptions = [
      "Heat loss should drive radiator sizing rather than guessing sizes",
      "Boiler/radiator model and supplier cost should stay TBC until quoted",
      "Gas-safe evidence and commissioning checks must be attached to the cost centre",
    ];
    profile.questions = [
      "Are we replacing like-for-like or changing pipe routes/locations?",
      "What boiler/radiator range should be priced?",
      "Is the system getting flushed, balanced and controls upgraded?",
    ];
    profile.supplierItems = [
      "Boiler, flue and controls",
      "Radiators and TRVs/lockshields",
      "Mag filter, chemicals and specialist valves",
    ];
  }

  if (/leak|burst|repair|reactive|emergency|tap|valve|blockage/.test(lower)) {
    profile.label = "Reactive plumbing repair";
    profile.costCentres = [
      "Attend and diagnose",
      "Isolate/repair",
      "Materials used",
      "Test and reinstate",
    ];
    profile.materials = [
      "Fittings and valves used on site",
      "Access/making-good materials if any surfaces are disturbed",
      "Specialist parts to supplier quote if not van stock",
    ];
    profile.labour = [
      "Engineer travel/attendance if charged",
      "Engineer repair time",
      "Return visit allowance if parts are required",
    ];
    profile.assumptions = [
      "Best handled as time and materials unless the fault is fully known",
      "Capture before/after photos and exact parts used for invoice backup",
    ];
    profile.questions = [
      "Is this being quoted upfront or logged as time and materials?",
      "Is access straightforward or do we need to open finishes?",
      "Are any specialist parts required before attendance?",
    ];
    profile.supplierItems = [
      "Specialist valve, cartridge, pump or appliance part if not standard stock",
    ];
  }

  return profile;
}

function buildPilotEstimateReply(project: TakeoffProject, message: string, mode: "draft" | "chat") {
  const scope = buildScopeLine(project, message);
  const profile = estimateProfileFor(project, message);
  const uploadedEvidence = documentSummary(project);
  const hasEvidence = project.documents.length > 0;
  const readyTone = mode === "draft"
    ? "I will stop asking broad questions and build this as a provisional estimate pack."
    : "Here is the first useful pricing build-up I would create from that.";

  return [
    readyTone,
    "",
    `Understood scope: ${scope}`,
    `Likely cost centre type: ${profile.label}`,
    `Evidence held: ${uploadedEvidence}`,
    "",
    "Cost centres I would create:",
    bulletList(profile.costCentres),
    "",
    "Materials / supplier request:",
    bulletList([
      ...profile.materials,
      ...profile.supplierItems.map((item) => `${item} - send to supplier if no current rate is held`),
    ]),
    "",
    "Labour build-up:",
    bulletList(profile.labour),
    "",
    "Commercial assumptions before this becomes a client quote:",
    bulletList([
      ...profile.assumptions,
      hasEvidence ? "Use uploaded evidence to support the scope and exclusions." : "Add photos/LiDAR/notes if we need evidence before issue.",
    ]),
    "",
    "Targeted questions:",
    bulletList(profile.questions),
    "",
    "Next action: use Push into quote so NeXa creates the quote description, cost centres, labour/material lines and supplier request items directly on the linked quote.",
  ].join("\n");
}

function buildPilotReply(project: TakeoffProject, message: string) {
  const lower = message.toLowerCase();
  const forceDraft = /just price|price it|build it|quote it|send it|go ahead|ready|draft it|work it out/.test(lower);

  if (forceDraft) {
    return buildPilotEstimateReply(project, message, "draft");
  }

  if (/bathroom|toilet|basin|shower|cubicle|suite|wc|boiler|heating|radiator|heat loss|cylinder|leak|repair|reactive|drawing|boq|spec|schedule|pdf/.test(lower)) {
    return buildPilotEstimateReply(project, message, "chat");
  }

  if (!previousAssistantAsked(project, "included, what is excluded")) {
    return buildPilotEstimateReply(project, message, "chat");
  }

  return buildPilotEstimateReply(project, message, "draft");
}

async function runOpenAiSurveyChat(project: TakeoffProject, nextMessages: TakeoffSurveyChatMessage[], apiKey: string, model: string, actor: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text: [
              "You are NeXa AI Estimator for a UK plumbing, heating and bathroom contractor.",
              "Run a live quote-building conversation. Be practical, commercial and specific.",
              "The user expects a ChatGPT-like estimator, not a checklist. Usually produce a first-pass pricing build-up before asking questions.",
              "Do not repeat broad generic questions. Never ask 'what would someone regret not knowing'.",
              "Structure useful replies with these plain labels when relevant: Understood scope, Cost centres, Materials / supplier request, Labour build-up, Commercial assumptions, Targeted questions, Next action.",
              "Ask at most three targeted questions at a time, and only after you have given the useful first-pass breakdown.",
              "If the user says 'just price it', 'quote it', 'go ahead', or similar, switch into assumptions mode: summarise scope, propose cost centres, materials, labour allowances, supplier quote items and review risks.",
              "Do not invent a final fixed sell price unless rates, supplier values, or explicit allowances have been provided in the project context. Use pricing structure and provisional assumptions instead.",
              "Do not claim to visually inspect photos, drawings or LiDAR unless extracted text/data is provided. You can refer to uploaded evidence by count/type.",
              "Write plain chat text. Do not use markdown headings or bold formatting. Short dash bullets are fine.",
              "Keep replies short enough for an estimator standing on site.",
            ].join("\n"),
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: [
              `Actor: ${actor}`,
              "Current NeXa project context:",
              projectContext(project),
              "",
              "Recent conversation:",
              recentTranscript(nextMessages),
              "",
              "Reply as NeXa with the next useful pricing response.",
            ].join("\n"),
          }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat failed (${response.status}).`);
  }

  const body = await response.json();
  const outputText = getOutputText(body);
  if (!outputText) throw new Error("OpenAI did not return a chat reply.");
  return outputText;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<SurveyChatPayload>(request);
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Type a message before sending." }, { status: 400 });
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  const actor = request.headers.get(employeeHeaderName) || "NeXa surveyor";
  const config = getTakeoffOpenAiConfig();
  const userMessage: TakeoffSurveyChatMessage = {
    id: makeId("survey-chat"),
    role: "user",
    text: message,
    createdAt: nowIso(),
  };
  const transcriptWithUser = [...(project.surveyChat ?? []), userMessage];

  let provider: "OpenAI" | "Pilot" = "Pilot";
  let reply = buildPilotReply(project, message);
  let warning = config.connected ? "" : "OpenAI is not connected, so NeXa used the pilot chat fallback.";

  if (config.connected) {
    try {
      reply = await runOpenAiSurveyChat(project, transcriptWithUser, config.apiKey, config.model, actor);
      provider = "OpenAI";
    } catch (error) {
      warning = error instanceof Error ? error.message : "OpenAI chat failed; pilot fallback used.";
    }
  }

  const assistantMessage: TakeoffSurveyChatMessage = {
    id: makeId("survey-chat"),
    role: "assistant",
    text: reply,
    createdAt: nowIso(),
  };
  const nextMessages = [...transcriptWithUser, assistantMessage];
  const updated = updateTakeoffProject(project.id, {
    surveyChat: nextMessages,
    description: project.description === "Takeoff scope to review." ? message : project.description,
  });

  if (!updated) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  return NextResponse.json({
    project: updated,
    provider,
    warning,
    message: assistantMessage,
  });
}
