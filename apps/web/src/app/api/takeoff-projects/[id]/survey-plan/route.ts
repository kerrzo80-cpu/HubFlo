import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  createDefaultTakeoffSurveyWorkflow,
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffProject,
  type TakeoffSurveyAnswer,
  type TakeoffSurveyQuestion,
  type TakeoffSurveyStopGoItem,
  type TakeoffSurveyWorkflow,
} from "@/lib/takeoff-data";

export const runtime = "nodejs";

type SurveyPlanPayload = Partial<TakeoffSurveyWorkflow> & {
  actor?: string;
};

type OpenAiSurveyPlanPayload = {
  stopGo: Array<{
    section: string;
    question: string;
    blockOn: TakeoffSurveyAnswer;
  }>;
  questions: Array<{
    section: string;
    question: string;
    required: boolean;
  }>;
};

const surveyPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["stopGo", "questions"],
  properties: {
    stopGo: {
      type: "array",
      minItems: 5,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "question", "blockOn"],
        properties: {
          section: { type: "string" },
          question: { type: "string" },
          blockOn: { type: "string", enum: ["Yes", "No", "Unknown", "N/A"] },
        },
      },
    },
    questions: {
      type: "array",
      minItems: 6,
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "question", "required"],
        properties: {
          section: { type: "string" },
          question: { type: "string" },
          required: { type: "boolean" },
        },
      },
    },
  },
};

function makeQuestionId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function getOutputText(response: unknown) {
  if (response && typeof response === "object" && "output_text" in response && typeof response.output_text === "string") {
    return response.output_text;
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
  }).filter(Boolean).join("\n");
}

function buildPilotQuestions(project: TakeoffProject, workflow: TakeoffSurveyWorkflow): TakeoffSurveyQuestion[] {
  const lowerScope = `${workflow.projectType} ${workflow.scopeNotes} ${project.description}`.toLowerCase();
  const questions: Omit<TakeoffSurveyQuestion, "id" | "answer">[] = [
    {
      section: "Project",
      question: `Confirm the exact project scope for ${workflow.projectType || "this survey"} and what is excluded.`,
      required: true,
    },
    {
      section: "Rooms",
      question: "Walk every room and record length, width, height, window width/height, outside walls, construction and radiator position.",
      required: true,
    },
    {
      section: "Heating",
      question: "Record existing boiler/heat source, cylinder, controls, pump/valves, pipe sizes and whether any items are reused.",
      required: true,
    },
    {
      section: "Pipework",
      question: "Confirm realistic pipe routes, boxing-in, floor lifting, access panels and areas needing making good.",
      required: true,
    },
    {
      section: "Electrical/controls",
      question: "Confirm programmer, thermostat, TRVs, wiring centre, fused spur and any electrical allowance needed.",
      required: true,
    },
    {
      section: "Customer",
      question: "Confirm customer preferences for radiator style, controls, boiler location, disruption, parking and working hours.",
      required: true,
    },
    {
      section: "Evidence",
      question: "Take photos of every room, window, radiator, pipe route, boiler/cylinder, flue, condensate, gas meter and consumer unit.",
      required: true,
    },
    {
      section: "Commercial",
      question: "List exclusions, assumptions, provisional sums and supplier items that need prices before quote issue.",
      required: true,
    },
  ];

  if (lowerScope.includes("underfloor")) {
    questions.push({
      section: "Underfloor heating",
      question: "Record floor build-up, manifold position, zones, insulation, floor coverings and controls per room.",
      required: true,
    });
  }

  if (lowerScope.includes("heat pump") || lowerScope.includes("renewable")) {
    questions.push({
      section: "Heat pump",
      question: "Check outdoor unit location, noise constraints, cylinder position, emitter suitability and electrical supply.",
      required: true,
    });
  }

  if (lowerScope.includes("bathroom")) {
    questions.push({
      section: "Bathroom",
      question: "Record sanitaryware positions, waste routes, hot/cold feeds, ventilation, waterproofing and tile/making-good scope.",
      required: true,
    });
  }

  return questions.map((question, index) => ({
    id: makeQuestionId("pilot-question", index),
    answer: "",
    ...question,
  }));
}

function buildPilotWorkflow(project: TakeoffProject, payload: SurveyPlanPayload = {}): TakeoffSurveyWorkflow {
  const workflow = createDefaultTakeoffSurveyWorkflow({
    ...(project.surveyWorkflow ?? {}),
    ...payload,
    step: payload.step ?? project.surveyWorkflow?.step ?? "scope",
  });

  return {
    ...workflow,
    aiQuestions: buildPilotQuestions(project, workflow),
    generatedAt: new Date().toISOString(),
    generatedBy: "Pilot",
  };
}

async function runOpenAiSurveyPlan(project: TakeoffProject, workflow: TakeoffSurveyWorkflow, apiKey: string, model: string) {
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
            text: "You are a UK plumbing and heating survey manager for NeXa. Create a conversational site-survey interview for office-reviewed quotes. The questions should sound like an experienced estimator asking the engineer/client one useful follow-up at a time. Keep stop/go items as separate safety gates only; use the main questions for job-specific back-and-forth detail about scope, rooms, pipe routes, materials, exclusions and supplier pricing.",
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: [
              `Project: ${project.name}`,
              `Customer: ${project.customer}`,
              `Site: ${project.site}`,
              `Scope: ${project.description}`,
              `Survey type: ${workflow.projectType}`,
              `Property: ${workflow.propertyType}`,
              `Existing system: ${workflow.existingSystem}`,
              `Fuel: ${workflow.fuelType}`,
              `Hot water: ${workflow.hotWater}`,
              `Occupancy: ${workflow.occupancy}`,
              `Planned rooms: ${workflow.plannedRoomCount || "unknown"}`,
              `Survey notes: ${workflow.scopeNotes || "none"}`,
            ].join("\n"),
          }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "nexa_survey_plan",
          strict: true,
          schema: surveyPlanSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI survey plan failed (${response.status}).`);
  }

  const body = await response.json();
  const outputText = getOutputText(body);
  if (!outputText) throw new Error("OpenAI did not return survey plan JSON.");

  const payload = JSON.parse(outputText) as OpenAiSurveyPlanPayload;
  const stopGo: TakeoffSurveyStopGoItem[] = payload.stopGo.slice(0, 10).map((item, index) => ({
    id: makeQuestionId("openai-stop", index),
    section: item.section.trim() || "Survey",
    question: item.question.trim(),
    answer: "Unknown" as const,
    blockOn: item.blockOn === "N/A" ? undefined : item.blockOn,
    notes: "",
  })).filter((item) => item.question);
  const questions: TakeoffSurveyQuestion[] = payload.questions.slice(0, 16).map((item, index) => ({
    id: makeQuestionId("openai-question", index),
    section: item.section.trim() || "Survey",
    question: item.question.trim(),
    required: Boolean(item.required),
    answer: "",
  })).filter((item) => item.question);

  return {
    ...workflow,
    stopGo: stopGo.length ? stopGo : workflow.stopGo,
    aiQuestions: questions.length ? questions : buildPilotQuestions(project, workflow),
    generatedAt: new Date().toISOString(),
    generatedBy: "OpenAI" as const,
    step: "scope" as const,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  const payload = await parseJsonRequestBody<SurveyPlanPayload>(request);
  const actor = payload?.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa surveyor";
  const baseWorkflow = createDefaultTakeoffSurveyWorkflow({
    ...(project.surveyWorkflow ?? {}),
    ...(payload ?? {}),
  });
  const config = getTakeoffOpenAiConfig();

  let workflow = buildPilotWorkflow(project, payload ?? {});
  if (config.connected) {
    try {
      workflow = await runOpenAiSurveyPlan(project, baseWorkflow, config.apiKey, config.model);
    } catch {
      workflow = {
        ...workflow,
        scopeNotes: workflow.scopeNotes
          ? `${workflow.scopeNotes}\nAI survey-plan generation failed; pilot checklist used by ${actor}.`
          : `AI survey-plan generation failed; pilot checklist used by ${actor}.`,
      };
    }
  }

  const updated = updateTakeoffProject(project.id, {
    surveyWorkflow: workflow,
    review: {
      ...project.review,
      riskFlags: Array.from(new Set([
        ...project.review.riskFlags,
        ...workflow.stopGo
          .filter((item) => item.blockOn && item.answer === item.blockOn)
          .map((item) => `${item.section}: ${item.question}`),
      ])),
    },
  });

  if (!updated) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  return NextResponse.json({
    project: updated,
    provider: workflow.generatedBy ?? "Pilot",
    generated: {
      stopGo: workflow.stopGo.length,
      questions: workflow.aiQuestions.length,
    },
  });
}
