import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  createDefaultTakeoffSurveyWorkflow,
  getTakeoffProject,
  runSurveyChatEstimatePackDraft,
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

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function sellFromMarkup(unitCost: number, markupPercent: number) {
  return unitCost * (1 + markupPercent / 100);
}

function buildSurveyEstimatePreview(project: TakeoffProject) {
  const sectionNames = Array.from(new Set([
    ...project.materialAllowances.map((line) => line.section),
    ...project.labourAllowances.map((line) => line.section),
  ].filter(Boolean)));
  const materialCost = project.materialAllowances.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const materialSell = project.materialAllowances.reduce((sum, line) => sum + line.quantity * sellFromMarkup(line.unitCost, line.markupPercent), 0);
  const labourCost = project.labourAllowances.reduce((sum, line) => sum + line.hours * line.costRate, 0);
  const labourSell = project.labourAllowances.reduce((sum, line) => sum + line.hours * sellFromMarkup(line.costRate, line.markupPercent), 0);

  return {
    costCentres: sectionNames.length || (project.materialAllowances.length || project.labourAllowances.length ? 1 : 0),
    materialCost: roundCurrency(materialCost),
    materialSell: roundCurrency(materialSell),
    labourCost: roundCurrency(labourCost),
    labourSell: roundCurrency(labourSell),
    supplierItems: project.supplierRequests.length,
    totalCost: roundCurrency(materialCost + labourCost),
    totalSell: roundCurrency(materialSell + labourSell),
    sections: sectionNames.map((section) => {
      const materialLines = project.materialAllowances.filter((line) => line.section === section);
      const labourLines = project.labourAllowances.filter((line) => line.section === section);
      const sectionMaterialSell = materialLines.reduce((sum, line) => sum + line.quantity * sellFromMarkup(line.unitCost, line.markupPercent), 0);
      const sectionLabourSell = labourLines.reduce((sum, line) => sum + line.hours * sellFromMarkup(line.costRate, line.markupPercent), 0);
      return {
        name: section,
        lines: materialLines.length + labourLines.length,
        supplierItems: project.supplierRequests.filter((line) => materialLines.some((material) => material.id === line.linkedMaterialId)).length,
        totalSell: roundCurrency(sectionMaterialSell + sectionLabourSell),
      };
    }),
  };
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
  const chatScope = latestSurveyScope(project);
  const workflow = createDefaultTakeoffSurveyWorkflow({
    ...(project.surveyWorkflow ?? {}),
    ...payload,
    scopeNotes: (payload.scopeNotes ?? project.surveyWorkflow?.scopeNotes) || chatScope,
    projectType: payload.projectType ?? project.surveyWorkflow?.projectType ?? inferSurveyType(chatScope || project.description),
    step: payload.step ?? project.surveyWorkflow?.step ?? "scope",
  });

  return {
    ...workflow,
    aiQuestions: buildPilotQuestions(project, workflow),
    generatedAt: new Date().toISOString(),
    generatedBy: "Pilot",
  };
}

function latestSurveyScope(project: TakeoffProject) {
  return (project.surveyChat ?? [])
    .filter((message) => message.role === "user")
    .map((message) => message.text.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

function inferSurveyType(scope: string) {
  const lower = scope.toLowerCase();
  const hasShowerScope = /shower|cubicle|enclosure|tray|screen|bi[- ]?fold|bifold/.test(lower);
  const widerBathroomSignals =
    /toilet|wc|basin|vanity|bath(?!room)|suite|sanitaryware|move\s+(?:the\s+)?(?:toilet|basin)|soil\s+route|full\s+bathroom|bathroom\s+(?:refurb|refurbishment|renovation)/.test(
      lower,
    );
  if (hasShowerScope && !widerBathroomSignals) return "Shower cubicle works";
  if (/bathroom|toilet|basin|shower|cubicle|wc/.test(lower)) return "Bathroom refurbishment";
  if (/boiler|heating|radiator|cylinder|flue/.test(lower)) return "Heating / boiler works";
  if (/leak|repair|reactive|emergency|tap|valve/.test(lower)) return "Reactive plumbing repair";
  return "Survey to price";
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
            text: [
              "You are a UK plumbing and heating survey manager for NeXa.",
              "Create a dynamic conversational site-survey interview for office-reviewed quotes, not a fixed checklist.",
              "First identify the item/system and the work type, then ask questions that change from those facts.",
              "Examples: radiator like-for-like asks isolation valves, drain-down, TRVs, inhibitor and system type; radiator relocation asks new location, pipe runs, floor type, route and heat loss.",
              "Apply the same adaptive logic to boilers, toilets, baths, showers, basins, cylinders, pipework, UFH and ASHP.",
              "Every question should help build scope, materials, labour, evidence confidence, exclusions or supplier RFQ lines.",
              "If photo/drawing/LiDAR evidence may be unclear, include a confidence-check prompt asking for another angle or a short video instead of guessing.",
              "Keep stop/go items as separate safety gates only; use the main questions for job-specific back-and-forth detail.",
              "Do not create generic four-part cost centres by default. Keep simple works simple.",
            ].join("\n"),
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
              `Latest survey chat scope: ${latestSurveyScope(project) || "none"}`,
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
  const chatScope = latestSurveyScope(project);
  const baseWorkflow = createDefaultTakeoffSurveyWorkflow({
    ...(project.surveyWorkflow ?? {}),
    ...(payload ?? {}),
    scopeNotes: (payload?.scopeNotes ?? project.surveyWorkflow?.scopeNotes) || chatScope,
    projectType: payload?.projectType ?? project.surveyWorkflow?.projectType ?? inferSurveyType(chatScope || project.description),
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

  const planned = updateTakeoffProject(project.id, {
    description: project.description === "Takeoff scope to review." && chatScope ? chatScope : project.description,
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

  if (!planned) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  const estimatePack = runSurveyChatEstimatePackDraft(project.id, actor);
  if (!estimatePack) {
    return NextResponse.json({ error: "Unable to build estimate pack" }, { status: 404 });
  }

  return NextResponse.json({
    project: estimatePack.project,
    provider: workflow.generatedBy ?? "Pilot",
    preview: buildSurveyEstimatePreview(estimatePack.project),
    generated: {
      stopGo: workflow.stopGo.length,
      questions: workflow.aiQuestions.length,
      ...estimatePack.generated,
    },
  });
}
