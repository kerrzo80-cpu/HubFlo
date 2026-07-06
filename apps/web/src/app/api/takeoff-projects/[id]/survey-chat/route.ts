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

function buildPilotReply(project: TakeoffProject, message: string) {
  const lower = message.toLowerCase();
  const scope = message.trim() || project.description;

  if (/just price|price it|build it|quote it|send it|go ahead|ready/.test(lower)) {
    return [
      "Okay. I will treat this as ready for a provisional quote pack rather than asking another broad question.",
      `Working scope: ${project.description === "Takeoff scope to review." ? scope : project.description}`,
      "Before issue, confirm only the commercial bits: what is included, what is excluded/making good, which items need supplier prices, and whether this is fixed price or allowance-led.",
      "Next step: click Build quote pack, then review the Takeoff output before pushing it back to the quote.",
    ].join("\n\n");
  }

  if (/bathroom|toilet|basin|shower|cubicle|suite|wc/.test(lower)) {
    return [
      "Got it. For this bathroom scope I would price it around strip-out, waste/soil alterations, hot and cold feeds, shower/basin/toilet positions, making good, and final fit-off.",
      "The only details I still need are targeted: is the toilet moving onto the same soil wall, are floors/walls being opened, who supplies the sanitaryware, and are tiling/electrics included or excluded?",
    ].join("\n\n");
  }

  if (/boiler|heating|radiator|heat loss|cylinder|flue/.test(lower)) {
    return [
      "Understood. For heating, I will build around heat loss, radiator schedule, boiler/cylinder/flue route, pipework access, controls and making-good assumptions.",
      "Next useful step: add heat loss for each room or tell me which rooms/radiators are changing, then I can turn that into supplier-price items.",
    ].join("\n\n");
  }

  if (/photo|picture|image/.test(lower) || project.documents.some((document) => document.kind === "Survey photo")) {
    return [
      "I have the photo evidence in the quote pack. Tell me what each photo is proving: existing layout, damage, pipe route, access, or finish level.",
      "Once OpenAI is connected, I can read the uploaded images directly; until then I need your short description beside the photos.",
    ].join("\n\n");
  }

  if (/drawing|boq|spec|schedule|pdf/.test(lower)) {
    return "Upload the drawing, spec or BOQ here, then I can turn it into the Takeoff output. If supplier prices are needed, mark those items for the supplier request rather than pricing them from memory.";
  }

  if (!previousAssistantAsked(project, "included, what is excluded")) {
    return [
      `I have logged the scope as: ${scope}.`,
      "Tell me the pricing basis now: what is included, what is excluded, and which materials need supplier prices?",
    ].join("\n\n");
  }

  return "Got it. I have enough to move forward with assumptions. Click Build quote pack and I will turn this conversation and evidence into the review output.";
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
              "Do not repeat broad generic questions. Never ask 'what would someone regret not knowing'.",
              "Ask at most three targeted questions at a time, and only if they unblock pricing.",
              "If the user says 'just price it', 'quote it', 'go ahead', or similar, switch into assumptions mode: summarise scope, list missing commercial assumptions, and tell them to build/review the quote pack.",
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
