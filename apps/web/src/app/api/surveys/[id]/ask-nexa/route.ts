import { NextResponse } from "next/server";
import {
  buildDynamicSurveyPath,
  inferSurveyorIntent,
  reviewSurveyCompletion,
  surveyQuestionsForJobType,
  type SurveyAssistantMessage,
  type SurveyRecord,
} from "@hubflo/domain";

import { parseJsonRequestBody } from "@/lib/http";
import { canManageSurveys, surveyRequestContext } from "@/lib/survey-api";
import { getSurvey, updateSurvey } from "@/lib/survey-estimator-store";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

export const runtime = "nodejs";

type AskNexaBody = {
  message?: string;
  activeStep?: string;
  expectedVersion?: number;
};

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
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

function surveyContext(survey: SurveyRecord, activeStep: string) {
  const review = reviewSurveyCompletion(survey);
  const questions = surveyQuestionsForJobType(survey.jobType);
  const dynamicPath = buildDynamicSurveyPath(inferSurveyorIntent({
    text: `${survey.customerRequirements} ${survey.scopeItems.map((item) => `${item.taskType} ${item.notes}`).join(" ")}`,
    jobType: survey.jobType,
    currentIntent: survey.surveyIntent,
    evidenceCount: survey.photos.length,
  }));
  const unanswered = questions.filter((question) => {
    const answer = survey.answers.find((item) => item.key === question.key);
    return question.required && (!answer || (!String(answer.value ?? "").trim() && answer.status !== "Not applicable"));
  });

  return [
    `Survey: ${survey.reference} (${survey.status})`,
    `Current guided stage: ${activeStep}`,
    `Linked record: ${survey.jobLink ? `${survey.jobLink.type} ${survey.jobLink.reference}` : "not linked"}`,
    `Customer/site: ${survey.customerName || "TBC"} / ${survey.siteAddress || "TBC"}`,
    `Job type: ${survey.jobType}; market: ${survey.market}; occupancy: ${survey.occupancy}`,
    `Dynamic survey intent: ${dynamicPath.intent.itemGroup}; ${dynamicPath.intent.workType}; evidence confidence ${dynamicPath.intent.confidence}`,
    `Dynamic next questions: ${dynamicPath.nextQuestions.map((item) => item.question).join(" | ")}`,
    `Dynamic materials: ${dynamicPath.materialBuild.join(" | ")}`,
    `Dynamic labour: ${dynamicPath.labourBuild.join(" | ")}`,
    `Dynamic Takeoffs handoff: ${dynamicPath.takeoffHandoff.join(" | ")}`,
    `Customer requirement: ${survey.customerRequirements || "TBC"}`,
    `Recorded condition answers: ${survey.answers.length}; required unanswered: ${unanswered.map((item) => item.question).join(" | ") || "none"}`,
    `Scope: ${survey.scopeItems.map((item) => `${item.taskType} [${item.trade}, ${item.roomOrArea || "area TBC"}, ${item.status}]`).join(" | ") || "none"}`,
    `Rooms: ${survey.rooms.map((room) => `${room.name} ${room.lengthM || "?"}x${room.widthM || "?"}x${room.heightM || "?"}m`).join(" | ") || "none"}`,
    `Pipe runs: ${survey.pipeRuns.map((run) => `${run.service} ${run.fromLocation || "?"} to ${run.toLocation || "?"}, ${run.measuredLengthM ?? "?"}m ${run.pipeSize || "size TBC"} ${run.measurementStatus}`).join(" | ") || "none"}`,
    `Equipment: ${survey.equipmentItems.map((item) => `${item.quantity}x ${item.description || item.category} ${item.make} ${item.model} [${item.status}${item.rfqRequired ? ", RFQ" : ""}]`).join(" | ") || "none"}`,
    `Photos: ${survey.photos.map((photo) => `${photo.category}: ${photo.caption || "caption missing"}`).join(" | ") || "none"}`,
    `Work by others: ${survey.workByOthers.join(" | ") || "none"}`,
    `Assumptions: ${survey.assumptions.join(" | ") || "none"}`,
    `Completion blockers: ${review.blockers.map((item) => item.message).join(" | ") || "none"}`,
    `Pricing-readiness issues: ${review.pricingReadinessIssues.map((item) => item.message).join(" | ") || "none"}`,
    `Missing information: ${review.missingInformation.map((item) => item.message).join(" | ") || "none"}`,
    `Supplier RFQs: ${review.supplierRfqs.map((item) => item.message).join(" | ") || "none"}`,
  ].join("\n");
}

function recentTranscript(messages: SurveyAssistantMessage[]) {
  return messages.slice(-16).map((message) => (
    `${message.role === "assistant" ? "NeXa" : "Surveyor"} [${message.step}]: ${message.text}`
  )).join("\n");
}

function fallbackReply(survey: SurveyRecord, activeStep: string) {
  const review = reviewSurveyCompletion(survey);
  const dynamicPath = buildDynamicSurveyPath(inferSurveyorIntent({
    text: `${survey.customerRequirements} ${survey.scopeItems.map((item) => `${item.taskType} ${item.notes}`).join(" ")}`,
    jobType: survey.jobType,
    currentIntent: survey.surveyIntent,
    evidenceCount: survey.photos.length,
  }));
  const items: string[] = [];

  if (activeStep === "details") {
    if (!survey.jobLink) items.push("Link the correct lead, quote or job.");
    if (!survey.customerName.trim() || !survey.siteAddress.trim()) items.push("Confirm the customer and full site address.");
    if (!survey.customerRequirements.trim()) items.push("Record the outcome the customer is asking for.");
    if (survey.customerRequirements.trim()) items.push(`Confirm the survey path is ${dynamicPath.intent.itemGroup} / ${dynamicPath.intent.workType}.`);
  } else if (activeStep === "conditions") {
    items.push(...dynamicPath.nextQuestions.slice(0, 3).map((item) => item.question));
  } else if (activeStep === "scope") {
    items.push(...dynamicPath.nextQuestions.slice(0, 2).map((item) => item.question));
    if (!survey.scopeItems.length) items.push("Add each proposed task as a separate scope item with its trade and room/area.");
    if (!survey.workByOthers.length) items.push("Confirm any work by the client, main contractor or other trades.");
    if (!survey.assumptions.length) items.push("Record any assumptions that the estimator must not treat as confirmed facts.");
  } else if (activeStep === "measurements") {
    if (!survey.rooms.length) items.push("Add the affected rooms or work areas.");
    if (!survey.pipeRuns.length) items.push("Add each relevant service route separately, including length and measurement status.");
    if (!survey.equipmentItems.length) items.push("Add fixtures or equipment that must be supplied, retained or sent for an RFQ.");
  } else if (activeStep === "photos") {
    if (!survey.photos.length) items.push("Add an overview plus evidence of existing condition, proposed positions and service routes.");
    if (survey.photos.some((photo) => !photo.caption.trim())) items.push("Caption every photograph with what it proves.");
  } else {
    items.push(...review.blockers.slice(0, 3).map((item) => item.message));
    if (!items.length) items.push(...review.pricingReadinessIssues.slice(0, 3).map((item) => item.message));
    if (!items.length) items.push(...review.missingInformation.slice(0, 3).map((item) => item.message));
    if (!items.length) items.push("The essential survey checks are complete. Review TBC items and supplier RFQs before sending to Estimator.");
  }

  return [
    `For the ${activeStep} stage, the next useful checks are:`,
    ...items.slice(0, 3).map((item) => `- ${item}`),
    "OpenAI is unavailable, so this reply is based on NeXa's structured completion checks.",
  ].join("\n");
}

async function runOpenAi(
  survey: SurveyRecord,
  messages: SurveyAssistantMessage[],
  activeStep: string,
  apiKey: string,
  model: string,
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text: [
              "You are Ask NeXa inside a structured site-survey workflow for a UK plumbing, heating and building contractor.",
              "Do not behave like a fixed questionnaire. First identify the item/asset and the work type, then branch your next question from that.",
              "Examples: radiator like-for-like means ask isolation valves, drain-down, TRVs, inhibitor and system type; radiator relocation means ask new position, pipe route, floor type, route length and heat loss.",
              "Apply the same adaptive logic to boilers, toilets, baths, showers, basins, cylinders, pipework and heating systems.",
              "Every answer should refine the scope, likely materials, labour and quote structure. Avoid irrelevant questions.",
              "Use the recorded survey facts below. Never invent a measurement, product, condition or price.",
              "Answer the user's actual question first. Then identify only the most relevant missing evidence for the current guided stage.",
              "Ask no more than three targeted questions. Do not repeat a question already answered in the survey or transcript.",
              "If photo evidence is unclear or confidence is low, ask for another angle or a short video instead of guessing.",
              "Do not create generic four-part cost centres. Surveyor gathers facts; Estimator later creates materials, labour and cost centres from reviewed data.",
              "If drawings, specifications or a contractor BOQ need quantity extraction, explain that they belong in NeXa Takeoffs and state exactly what should be handed over.",
              "When photographs exist, refer only to their captions/categories unless image content has been explicitly extracted.",
              "Keep the answer practical and concise for someone standing on site. Plain text and short dash bullets only.",
            ].join("\n"),
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: [
              "Current structured survey:",
              surveyContext(survey, activeStep),
              "",
              "Recent Ask NeXa conversation:",
              recentTranscript(messages),
              "",
              "Give the next useful response without repeating answered questions.",
            ].join("\n"),
          }],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}.`);
  const output = getOutputText(await response.json());
  if (!output) throw new Error("OpenAI did not return a reply.");
  return output;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<AskNexaBody>(request);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "Type a question for NeXa." }, { status: 400 });

  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  const survey = getSurvey(tenantId, id);
  if (!survey) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
  if (body.expectedVersion !== undefined && body.expectedVersion !== survey.version) {
    return NextResponse.json({ error: "The survey changed before NeXa replied. Reload and try again.", current: survey }, { status: 409 });
  }

  const activeStep = body.activeStep?.trim() || "details";
  const userMessage: SurveyAssistantMessage = {
    id: makeId("survey-ai"), role: "user", text: message, step: activeStep, createdAt: new Date().toISOString(),
  };
  const transcript = [...(survey.assistantMessages || []), userMessage];
  const config = getTakeoffOpenAiConfig();
  let provider: "OpenAI" | "Pilot" = "Pilot";
  let warning = config.connected ? "" : "OpenAI is not connected; NeXa used its structured survey checks.";
  let reply = fallbackReply(survey, activeStep);

  if (config.connected) {
    try {
      reply = await runOpenAi(survey, transcript, activeStep, config.apiKey, config.model);
      provider = "OpenAI";
    } catch (error) {
      warning = error instanceof Error ? `${error.message} NeXa used its structured survey checks.` : "OpenAI failed; NeXa used its structured survey checks.";
    }
  }

  const assistantMessage: SurveyAssistantMessage = {
    id: makeId("survey-ai"), role: "assistant", text: reply, step: activeStep, createdAt: new Date().toISOString(),
  };
  const result = updateSurvey(
    tenantId,
    survey.id,
    { assistantMessages: [...transcript, assistantMessage].slice(-100) },
    body.expectedVersion,
    actor,
    { action: "Asked NeXa", detail: `Ask NeXa used on the ${activeStep} stage (${provider}).` },
  );
  if (!result.ok) {
    const status = result.reason === "version_conflict" ? 409 : result.reason === "not_found" ? 404 : 422;
    return NextResponse.json({ error: result.message, current: result.current }, { status });
  }

  return NextResponse.json({ survey: result.value, message: assistantMessage, provider, warning });
}
