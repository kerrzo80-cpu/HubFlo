import {
  buildDynamicSurveyPath,
  inferSurveyorIntent,
  reviewSurveyCompletion,
  type SurveyRecord,
  type SurveyScopeItem,
} from "@hubflo/domain";

import { resolveOpenAiApiKey } from "@/lib/openai-env";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  completeSurvey,
  getEstimate,
  getSurvey,
  sendSurveyToEstimator,
  updateSurvey,
} from "@/lib/survey-estimator-store";
import { openAiFetch } from "@/lib/openai-fetch";

export type AiQuotePackResult = {
  ok: boolean;
  status: number;
  survey?: SurveyRecord;
  estimateId?: string;
  estimateReference?: string;
  aiUsed: boolean;
  summary: string;
  blockers?: string[];
  error?: string;
};

type AiEnrichment = {
  assumptions: string[];
  exclusions: string[];
  riskNotes: string[];
  scopeSuggestions: Array<{
    taskType: string;
    trade: SurveyScopeItem["trade"];
    roomOrArea: string;
    notes: string;
  }>;
  summary: string;
};

function uniqueLines(existing: string[], incoming: string[]) {
  const seen = new Set(existing.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const next = [...existing];
  for (const line of incoming) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}

function getOutputText(response: unknown) {
  if (response && typeof response === "object" && "output_text" in response && typeof (response as { output_text?: unknown }).output_text === "string") {
    return (response as { output_text: string }).output_text.trim();
  }
  const output = response && typeof response === "object" && "output" in response ? (response as { output?: unknown }).output : null;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray((item as { content?: unknown }).content)) return [];
    return ((item as { content: unknown[] }).content).map((content) => (
      content && typeof content === "object" && "text" in content && typeof (content as { text?: unknown }).text === "string"
        ? (content as { text: string }).text
        : ""
    ));
  }).filter(Boolean).join("\n").trim();
}

async function enrichSurveyWithAi(survey: SurveyRecord): Promise<{ enrichment: AiEnrichment | null; aiUsed: boolean }> {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    const dynamicPath = buildDynamicSurveyPath(inferSurveyorIntent({
      text: `${survey.customerRequirements} ${survey.scopeItems.map((item) => item.taskType).join(" ")}`,
      jobType: survey.jobType,
      currentIntent: survey.surveyIntent,
      evidenceCount: survey.photos.length,
    }));
    return {
      aiUsed: false,
      enrichment: {
        assumptions: [`Generated without OpenAI using the Ayla ${dynamicPath.intent.itemGroup} rules.`],
        exclusions: ["Anything not recorded in the survey evidence remains excluded until confirmed."],
        riskNotes: dynamicPath.nextQuestions.slice(0, 3).map((item) => `Confirm on site: ${item.question}`),
        scopeSuggestions: [],
        summary: "Rule-based Ayla pack prepared from the live survey evidence. Add NEXA_OPENAI_API_KEY for freer AI enrichment.",
      },
    };
  }

  const model = getTakeoffOpenAiConfig().model;
  const context = {
    reference: survey.reference,
    jobType: survey.jobType,
    customerRequirements: survey.customerRequirements,
    answers: survey.answers.map((item) => ({ question: item.question, value: item.value, status: item.status })),
    scopeItems: survey.scopeItems,
    rooms: survey.rooms,
    pipeRuns: survey.pipeRuns,
    equipmentItems: survey.equipmentItems,
    photos: survey.photos.map((photo) => ({ category: photo.category, caption: photo.caption, fileName: photo.fileName })),
    assumptions: survey.assumptions,
    workByOthers: survey.workByOthers,
  };

  try {
    const response = await openAiFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "You are Ayla preparing an estimating pack for Ayla Surveyor.",
                "Only use the supplied survey JSON. Do not invent measurements, makes, models or prices.",
                "Suggest missing commercial assumptions, exclusions, risks and optional extra scope lines that an estimator should review.",
                "Keep suggestions practical for UK plumbing and heating work.",
                "Return strict JSON only.",
              ].join(" "),
            }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify(context) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "nexa_ai_quote_pack",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                assumptions: { type: "array", items: { type: "string" } },
                exclusions: { type: "array", items: { type: "string" } },
                riskNotes: { type: "array", items: { type: "string" } },
                scopeSuggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      taskType: { type: "string" },
                      trade: {
                        type: "string",
                        enum: ["Plumbing/Heating", "Joinery", "Electrical", "Tiling", "Decoration", "Building works", "Other"],
                      },
                      roomOrArea: { type: "string" },
                      notes: { type: "string" },
                    },
                    required: ["taskType", "trade", "roomOrArea", "notes"],
                  },
                },
              },
              required: ["summary", "assumptions", "exclusions", "riskNotes", "scopeSuggestions"],
            },
          },
        },
      }),
    });
    if (!response.ok) return { enrichment: null, aiUsed: false };
    const body = await response.json();
    const text = getOutputText(body);
    if (!text) return { enrichment: null, aiUsed: false };
    const parsed = JSON.parse(text) as AiEnrichment;
    return {
      aiUsed: true,
      enrichment: {
        summary: typeof parsed.summary === "string" ? parsed.summary : "AI estimate pack prepared from survey evidence.",
        assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.map(String) : [],
        exclusions: Array.isArray(parsed.exclusions) ? parsed.exclusions.map(String) : [],
        riskNotes: Array.isArray(parsed.riskNotes) ? parsed.riskNotes.map(String) : [],
        scopeSuggestions: Array.isArray(parsed.scopeSuggestions)
          ? parsed.scopeSuggestions
            .filter((item) => item && typeof item === "object")
            .map((item) => ({
              taskType: String(item.taskType || "").trim(),
              trade: (item.trade || "Plumbing/Heating") as SurveyScopeItem["trade"],
              roomOrArea: String(item.roomOrArea || "").trim(),
              notes: String(item.notes || "").trim(),
            }))
            .filter((item) => item.taskType)
          : [],
      },
    };
  } catch {
    return { enrichment: null, aiUsed: false };
  }
}

function applyEnrichment(survey: SurveyRecord, enrichment: AiEnrichment): Partial<SurveyRecord> {
  const existingTaskTypes = new Set(survey.scopeItems.map((item) => item.taskType.trim().toLowerCase()));
  const newScopeItems: SurveyScopeItem[] = enrichment.scopeSuggestions
    .filter((item) => !existingTaskTypes.has(item.taskType.trim().toLowerCase()))
    .slice(0, 8)
    .map((item) => ({
      id: `survey-scope-ai-${crypto.randomUUID()}`,
      taskType: item.taskType,
      trade: item.trade,
      roomOrArea: item.roomOrArea,
      existingPosition: "",
      proposedPosition: "",
      quantity: 1,
      dimensions: "",
      status: "Assumed",
      responsibility: "EWG",
      notes: `${item.notes} (Ayla AI suggestion — review before pricing)`,
      photoIds: [],
    }));

  return {
    assumptions: uniqueLines(
      survey.assumptions,
      [
        ...enrichment.assumptions,
        ...enrichment.riskNotes.map((item) => `Risk / check: ${item}`),
        ...enrichment.exclusions.map((item) => `Exclusion: ${item}`),
      ],
    ),
    workByOthers: uniqueLines(survey.workByOthers, enrichment.exclusions),
    scopeItems: [...survey.scopeItems, ...newScopeItems],
  };
}

export async function buildAiQuotePack(
  tenantId: string,
  surveyId: string,
  actor: string,
  expectedVersion?: number,
): Promise<AiQuotePackResult> {
  let survey = getSurvey(tenantId, surveyId);
  if (!survey) {
    return { ok: false, status: 404, aiUsed: false, summary: "", error: "Survey not found." };
  }

  const { enrichment, aiUsed } = await enrichSurveyWithAi(survey);
  if (enrichment) {
    const patch = applyEnrichment(survey, enrichment);
    const updated = updateSurvey(
      tenantId,
      survey.id,
      patch,
      expectedVersion ?? survey.version,
      actor,
      { action: "AI quote pack prepared", detail: enrichment.summary },
    );
    if (!updated.ok) {
      return {
        ok: false,
        status: updated.reason === "version_conflict" ? 409 : 422,
        aiUsed,
        summary: enrichment.summary,
        error: updated.message || "Unable to save Ayla's estimate suggestions.",
        survey,
      };
    }
    survey = updated.value;
  }

  let review = reviewSurveyCompletion(survey);
  if (survey.status !== "Complete" && survey.status !== "Sent to estimator") {
    if (!review.canComplete) {
      return {
        ok: false,
        status: 422,
        aiUsed,
        summary: enrichment?.summary || "Survey is not ready for an estimate pack.",
        blockers: [
          ...review.blockers.map((item) => item.message),
          ...review.pricingReadinessIssues.map((item) => item.message),
        ],
        error: review.blockers[0]?.message || "Resolve the survey completion blockers, then try again.",
        survey,
      };
    }
    const completed = completeSurvey(tenantId, survey.id, survey.version, actor);
    if (!completed.ok) {
      return {
        ok: false,
        status: 422,
        aiUsed,
        summary: enrichment?.summary || "",
        blockers: completed.review?.blockers.map((item) => item.message),
        error: completed.message || "Unable to complete the survey.",
        survey,
      };
    }
    survey = completed.value;
    review = completed.review || reviewSurveyCompletion(survey);
  }

  if (!review.canSendToEstimator && survey.status !== "Sent to estimator") {
    return {
      ok: false,
      status: 422,
      aiUsed,
      summary: enrichment?.summary || "Survey captured, but pricing readiness is incomplete.",
      blockers: review.pricingReadinessIssues.map((item) => item.message),
      error: review.pricingReadinessIssues[0]?.message || "Finish the pricing-readiness items before generating the estimate pack.",
      survey,
    };
  }

  const sent = sendSurveyToEstimator(tenantId, survey.id, survey.version, actor);
  if (!sent.ok) {
    return {
      ok: false,
      status: sent.reason === "version_conflict" ? 409 : 422,
      aiUsed,
      summary: enrichment?.summary || "",
      error: sent.message || "Unable to create the estimate.",
      survey,
    };
  }

  const estimate = getEstimate(tenantId, sent.value.estimate.id) || sent.value.estimate;
  return {
    ok: true,
    status: 200,
    aiUsed,
    summary: enrichment?.summary
      || `Estimate ${estimate.reference} created from survey ${survey.reference}. Review materials and labour, then push to a Core quote.`,
    survey: sent.value.survey,
    estimateId: estimate.id,
    estimateReference: estimate.reference,
  };
}
