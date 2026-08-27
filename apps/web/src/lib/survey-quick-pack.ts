import {
  buildDynamicSurveyPath,
  inferSurveyJobTypeFromText,
  inferSurveyorIntent,
  seededPricingProfiles,
  seededSimproEstimateMappings,
  type EstimateLabourLine,
  type EstimateMaterialLine,
  type EstimateRecord,
  type EstimateTrade,
  type SurveyRecord,
  type SurveyScopeItem,
} from "@hubflo/domain";

import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  createTakeoffProject,
  updateTakeoffProject,
  getTakeoffProject,
  type TakeoffDocument,
  type TakeoffLabourAllowance,
  type TakeoffMaterialAllowance,
  type TakeoffServicesMarkup,
  type TakeoffSupplierRequestItem,
} from "@/lib/takeoff-data";
import {
  filterSupplierRequestsForKeptMaterials,
  filterSurveyMaterialsCoveredByPackages,
} from "@/lib/takeoff-markup-packages";
import {
  isInstallMaterialOnRemoval,
  isRemovalCostCentre,
  itemisedMaterialsForRemoval as removalMaterialSeed,
} from "@/lib/takeoff-removal-materials";
import {
  attachQuickPackToSurvey,
  getEstimate,
  getSurvey,
  saveEstimateRecord,
  updateSurvey,
} from "@/lib/survey-estimator-store";
import { getHubDetailState } from "@/lib/hub-detail-store";

export type QuickCostCentreMaterial = {
  description: string;
  quantity: number;
  unit: string;
};

export type QuickCostCentreLabour = {
  description: string;
  hours: number;
  trade: string;
};

export type QuickCostCentre = {
  name: string;
  jobDescription: string;
  trade: EstimateTrade;
  materials: QuickCostCentreMaterial[];
  labour: QuickCostCentreLabour[];
};

export type QuickClarifyingQuestion = {
  key: string;
  question: string;
  why: string;
};

export type QuickPackResult = {
  ok: boolean;
  status: number;
  survey?: SurveyRecord;
  estimateId?: string;
  estimateReference?: string;
  takeoffProjectId?: string;
  costCentres: QuickCostCentre[];
  clarifyingQuestions: QuickClarifyingQuestion[];
  aiUsed: boolean;
  aiConnected: boolean;
  aiModel?: string;
  summary: string;
  error?: string;
};

type AiQuickPack = {
  summary: string;
  costCentres: QuickCostCentre[];
  clarifyingQuestions: QuickClarifyingQuestion[];
};

const tradeOptions: EstimateTrade[] = [
  "Plumbing/Heating",
  "Joinery",
  "Electrical",
  "Tiling/Flooring",
  "Painting",
  "Other",
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
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

function normaliseTrade(value: unknown): EstimateTrade {
  const text = String(value || "").trim();
  if (tradeOptions.includes(text as EstimateTrade)) return text as EstimateTrade;
  if (/electr/i.test(text)) return "Electrical";
  if (/join/i.test(text)) return "Joinery";
  if (/til/i.test(text) || /floor/i.test(text)) return "Tiling/Flooring";
  if (/paint/i.test(text) || /decor/i.test(text)) return "Painting";
  return "Plumbing/Heating";
}

function normaliseUnit(value: unknown) {
  const unit = String(value || "nr").trim().toLowerCase();
  if (!unit || unit === "lot" || unit === "item" || unit === "allowance" || unit === "sum" || unit === "ls") return "nr";
  if (unit === "mtr" || unit === "lm" || unit === "lin.m") return "m";
  if (unit === "no" || unit === "nos" || unit === "each" || unit === "ea") return "nr";
  return String(value || "nr").trim() || "nr";
}

function isVagueMaterialDescription(description: string) {
  const text = description.trim().toLowerCase();
  if (!text) return true;
  return /^(new\s+)?(pipework|plumbing|heating|materials?|fittings?|sundries|consumables|allowance|provisional|tbc|as required)\b/.test(text)
    || /\b(1\s+)?lot\b/.test(text)
    || /\ballowance\b/.test(text)
    || /\bas required\b/.test(text)
    || /\bmaterials?\s+only\b/.test(text)
    || text.split(/\s+/).length <= 3 && /materials?|fittings?|pipework/.test(text);
}

function itemisedMaterialsForRemoval(): QuickCostCentreMaterial[] {
  return removalMaterialSeed().map((item) => materialLine(item.description, item.quantity, item.unit));
}

function clarifyingQuestionsForWorks(works: string, answeredKeys: Set<string>): QuickClarifyingQuestion[] {
  const text = works.toLowerCase();
  const questions: QuickClarifyingQuestion[] = [];
  const push = (key: string, question: string, why: string) => {
    if (!answeredKeys.has(key)) questions.push({ key, question, why });
  };

  if (/rip\s*out|renew|replace.*pipe|pipework|pipe work|heating|plumb/.test(text)) {
    push("buddy-pipe-material", "What pipe material and jointing method is on site (copper solder, press-fit, push-fit, plastic)?", "This decides the fittings list and labour.");
    push("buddy-pipe-sizes", "Which pipe sizes are being renewed (15mm, 22mm, mixed), and roughly how much route is changing?", "Stops the RFQ from guessing metreage.");
    push("buddy-system-drain", "Does the system need a full drain-down, or can work be isolated locally?", "Big labour difference and treatment chemicals.");
    push("buddy-access", "Where does the pipe run — floors, boxing, loft, external — and what making-good is expected?", "Access changes labour and exclusions.");
  } else if (/boiler/.test(text)) {
    push("buddy-boiler-model", "What is the existing boiler make/model, and is this a like-for-like swap or relocation?", "Controls flue, condensate, gas and controls scope.");
    push("buddy-flue-route", "What flue route/terminal is proposed?", "Flue parts and labour are often the biggest miss.");
    push("buddy-controls", "Are controls staying, being upgraded, or unknown?", "Wiring/controls need to be on the RFQ or excluded.");
  } else if (/radiator|towel/.test(text)) {
    push("buddy-rad-scope", "Is this like-for-like in the same position, or a move/resize?", "Relocation needs pipe route materials; like-for-like may not.");
    push("buddy-rad-valves", "Are TRV/lockshields being reused or replaced?", "Valve sets are commonly missed.");
  } else {
    push("buddy-scope-clear", "What exactly is included and excluded in these works?", "Keeps the pack from inventing scope.");
    push("buddy-key-sizes", "Any known pipe sizes, appliance models or measured lengths?", "Turns provisional materials into a tighter RFQ.");
  }

  if (!answeredKeys.has("buddy-supplier-prefs")) {
    questions.push({
      key: "buddy-supplier-prefs",
      question: "Any preferred supplier, brand standards, or parts that must match existing?",
      why: "Stops the RFQ listing the wrong fittings family.",
    });
  }

  return questions.slice(0, 5);
}

function normaliseClarifyingQuestions(raw: unknown, works: string, answeredKeys: Set<string>): QuickClarifyingQuestion[] {
  // Trust an explicit AI array (including empty = description clear enough).
  // Only use rule-based questions when the model omitted the field.
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item, index) => ({
        key: String(item.key || `buddy-q-${index + 1}`).trim() || `buddy-q-${index + 1}`,
        question: String(item.question || "").trim(),
        why: String(item.why || "Needed before a firm supplier RFQ.").trim() || "Needed before a firm supplier RFQ.",
      }))
      .filter((item) => item.question && !answeredKeys.has(item.key))
      .slice(0, 5);
  }
  return clarifyingQuestionsForWorks(works, answeredKeys);
}

function mergeBuddyAnswers(survey: SurveyRecord, questions: QuickClarifyingQuestion[]) {
  const existingByKey = new Map(survey.answers.map((answer) => [answer.key, answer]));
  const next = [...survey.answers];
  const stamped = nowIso();
  questions.forEach((question) => {
    const existing = existingByKey.get(question.key);
    if (existing) {
      if (existing.question !== question.question || existing.notes !== question.why) {
        const index = next.findIndex((item) => item.id === existing.id);
        if (index >= 0) {
          next[index] = {
            ...existing,
            question: question.question,
            notes: question.why,
            updatedAt: stamped,
          };
        }
      }
      return;
    }
    next.push({
      id: makeId("survey-answer"),
      key: question.key,
      section: "Blake checks",
      question: question.question,
      value: "",
      status: "TBC",
      tbcReason: question.why,
      notes: question.why,
      photoIds: [],
      updatedAt: stamped,
    });
  });
  return next;
}

function materialLine(description: string, quantity: number, unit: string): QuickCostCentreMaterial {
  return { description, quantity, unit: normaliseUnit(unit) };
}

/** Practical UK plumbing RFQ lines for common works when sizes are not yet measured. */
function itemisedMaterialsForWorks(works: string): QuickCostCentreMaterial[] {
  const text = works.toLowerCase();
  if (/renew|replace.*pipe|pipework|pipe work|heating|plumb|rip\s*out/.test(text)) {
    return [
      materialLine("Copper tube 15mm (provisional — confirm from markup/measure)", 25, "m"),
      materialLine("Copper tube 22mm (provisional — confirm from markup/measure)", 12, "m"),
      materialLine("15mm elbow (end feed / press / push-fit to match site)", 20, "nr"),
      materialLine("15mm equal tee", 8, "nr"),
      materialLine("15mm coupling / straight connector", 10, "nr"),
      materialLine("22mm elbow", 10, "nr"),
      materialLine("22mm equal tee", 4, "nr"),
      materialLine("22×15mm reducing coupling", 6, "nr"),
      materialLine("15mm isolation / service valve", 6, "nr"),
      materialLine("Pipe clips / pipe supports 15–22mm", 40, "nr"),
      materialLine("PTFE tape", 2, "nr"),
      materialLine("Soft solder reel", 1, "nr"),
      materialLine("Flux pot", 1, "nr"),
      materialLine("Inhibitor (central heating system treatment)", 1, "nr"),
      materialLine("System cleaner / flush chemical", 1, "nr"),
    ];
  }
  if (/boiler/.test(text)) {
    return [
      materialLine("Boiler (make/model TBC — supplier quote)", 1, "nr"),
      materialLine("Magnetic filter", 1, "nr"),
      materialLine("Condensate pipe and fittings (provisional)", 8, "m"),
      materialLine("Gas isolation valve and fittings (size TBC)", 1, "nr"),
      materialLine("Flow/return copper tube 22mm (provisional)", 8, "m"),
      materialLine("22mm elbows / tees / couplings assortment for boiler connections", 12, "nr"),
      materialLine("Flue components (route/length TBC — supplier quote)", 1, "nr"),
      materialLine("Inhibitor", 1, "nr"),
      materialLine("System cleaner / flush chemical", 1, "nr"),
    ];
  }
  if (/radiator|towel/.test(text)) {
    return [
      materialLine("Radiator / towel rail (size/output TBC)", 1, "nr"),
      materialLine("TRV and lockshield valve set", 1, "nr"),
      materialLine("Copper tube 15mm (provisional route)", 6, "m"),
      materialLine("15mm elbows / couplings / tails adapters", 10, "nr"),
      materialLine("Pipe clips", 10, "nr"),
      materialLine("Inhibitor top-up", 1, "nr"),
    ];
  }
  return [
    materialLine("Copper tube 15mm (provisional — confirm from markup/measure)", 15, "m"),
    materialLine("15mm elbows / tees / couplings", 20, "nr"),
    materialLine("15mm isolation valves", 4, "nr"),
    materialLine("Pipe clips / supports", 20, "nr"),
    materialLine("PTFE tape", 1, "nr"),
    materialLine("Soft solder reel", 1, "nr"),
    materialLine("Flux pot", 1, "nr"),
  ];
}

function ensureItemisedMaterials(centre: QuickCostCentre, works: string): QuickCostCentre {
  if (isRemovalCostCentre(centre)) {
    const usable = centre.materials
      .filter((item) => !isVagueMaterialDescription(item.description))
      .filter((item) => !isInstallMaterialOnRemoval(item));
    const hadInstallLeak = centre.materials.some((item) => isInstallMaterialOnRemoval(item));
    if (hadInstallLeak || usable.length < 2) {
      return {
        ...centre,
        materials: itemisedMaterialsForRemoval(),
      };
    }
    return {
      ...centre,
      materials: usable.map((item) => ({
        ...item,
        unit: normaliseUnit(item.unit),
        quantity: item.quantity > 0 ? item.quantity : 1,
      })),
    };
  }

  const usable = centre.materials.filter((item) => !isVagueMaterialDescription(item.description));
  if (usable.length >= 4) {
    return {
      ...centre,
      materials: usable.map((item) => ({
        ...item,
        unit: normaliseUnit(item.unit),
        quantity: item.quantity > 0 ? item.quantity : 1,
      })),
    };
  }
  return {
    ...centre,
    materials: itemisedMaterialsForWorks(`${centre.name} ${centre.jobDescription} ${works}`),
  };
}

function normaliseCostCentres(raw: unknown, works = ""): QuickCostCentre[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const materials = Array.isArray(item.materials)
        ? item.materials
          .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
          .map((row) => ({
            description: String(row.description || "").trim(),
            quantity: Number(row.quantity) > 0 ? Number(row.quantity) : 1,
            unit: normaliseUnit(row.unit),
          }))
          .filter((row) => row.description)
        : [];
      const labour = Array.isArray(item.labour)
        ? item.labour
          .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
          .map((row) => ({
            description: String(row.description || "").trim(),
            hours: Number(row.hours) > 0 ? Number(row.hours) : 1,
            trade: String(row.trade || "Plumber").trim() || "Plumber",
          }))
          .filter((row) => row.description)
        : [];
      return ensureItemisedMaterials({
        name: String(item.name || "").trim(),
        jobDescription: String(item.jobDescription || "").trim(),
        trade: normaliseTrade(item.trade),
        materials,
        labour,
      }, works);
    })
    .filter((item) => item.name && item.jobDescription);
}

function fallbackCostCentres(survey: SurveyRecord, reason: string): AiQuickPack {
  const works = survey.customerRequirements.trim();
  const answeredKeys = new Set(
    survey.answers
      .filter((answer) => String(answer.value || "").trim())
      .map((answer) => answer.key),
  );
  const clarifyingQuestions = clarifyingQuestionsForWorks(works, answeredKeys);
  const intent = inferSurveyorIntent({
    text: works,
    jobType: survey.jobType,
    currentIntent: survey.surveyIntent,
    evidenceCount: survey.photos.length,
  });
  const path = buildDynamicSurveyPath(intent);
  const renewPipework = /rip\s*out|renew|replace.*pipe|old pipe|pipework/.test(works.toLowerCase());

  if (renewPipework) {
    return {
      summary: `${reason} Materials are itemised for supplier RFQ — lengths/sizes are provisional until markup confirms them.`,
      clarifyingQuestions,
      costCentres: [
        {
          name: "Pipework removal",
          jobDescription: "Isolate, drain where required, strip out existing pipework and prepare the route for renewal.",
          trade: "Plumbing/Heating",
          materials: itemisedMaterialsForRemoval(),
          labour: [
            { description: "Isolate, drain and remove existing pipework", hours: 8, trade: "Plumber" },
          ],
        },
        {
          name: "Pipework installation",
          jobDescription: works || "Install new pipework to replace the stripped-out system, then fill, treat, test and commission.",
          trade: "Plumbing/Heating",
          materials: itemisedMaterialsForWorks(works),
          labour: [
            { description: "Install, clip, joint and connect new pipework", hours: 10, trade: "Plumber" },
            { description: "Fill, treat, test and balance", hours: 2, trade: "Plumber" },
          ],
        },
      ],
    };
  }

  const name = `${path.intent.itemGroup} ${path.intent.workType}`.trim() || survey.jobType;
  return {
    summary: `${reason} Materials are itemised for supplier RFQ — review sizes and quantities before sending.`,
    clarifyingQuestions,
    costCentres: [
      ensureItemisedMaterials({
        name,
        jobDescription: works || `Carry out ${name.toLowerCase()} as described on site evidence.`,
        trade: "Plumbing/Heating",
        materials: [],
        labour: path.labourBuild.slice(0, 4).map((item) => ({
          description: item,
          hours: 2,
          trade: /electr/i.test(item) ? "Electrician" : /join/i.test(item) ? "Joiner" : "Plumber",
        })),
      }, works),
    ],
  };
}

function extractChatText(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content.trim() : "";
}

async function generateCostCentresWithAi(survey: SurveyRecord): Promise<{ pack: AiQuickPack; aiUsed: boolean; connected: boolean; error?: string }> {
  const openAi = getTakeoffOpenAiConfig();
  const apiKey = openAi.apiKey;
  if (!apiKey) {
    return {
      connected: false,
      aiUsed: false,
      error: "OpenAI key missing on this Render service.",
      pack: fallbackCostCentres(
        survey,
        "OpenAI is not connected on this live service. In Render → nexa-live → Environment, set OPENAI_API_KEY, then Manual Deploy / restart.",
      ),
    };
  }

  const answeredKeys = new Set(
    survey.answers
      .filter((answer) => String(answer.value || "").trim())
      .map((answer) => answer.key),
  );
  const model = openAi.model || "gpt-4.1-mini";
  const context = {
    reference: survey.reference,
    jobType: survey.jobType,
    customerRequirements: survey.customerRequirements,
    customerName: survey.customerName,
    siteAddress: survey.siteAddress,
    evidenceCount: survey.photos.length,
    answeredBuddyChecks: survey.answers
      .filter((answer) =>
        (answer.section === "Blake checks" || answer.section === "Buddy checks") &&
        String(answer.value || "").trim(),
      )
      .map((answer) => ({ key: answer.key, question: answer.question, answer: String(answer.value) })),
    photos: survey.photos.slice(0, 20).map((photo) => ({
      category: photo.category,
      caption: photo.caption,
      fileName: photo.fileName,
    })),
  };

  const prompt = [
    "You are Ayla building a Blake estimating pack for UK plumbing and heating.",
    "From the works description, Blake answers already given, and evidence metadata, propose cost centres.",
    "Each cost centre needs name, jobDescription, trade, materials[{description,quantity,unit}], labour[{description,hours,trade}].",
    "Materials are for a supplier RFQ: itemise specific products a merchant can price.",
    "NEVER use units or descriptions like lot, item, allowance, sundry, materials, pipework materials, or as required.",
    "Prefer concrete lines such as: Copper tube 15mm (m), 15mm elbow (nr), 15mm isolation valve (nr), pipe clips (nr), inhibitor (nr).",
    "If lengths/sizes are unknown, still list separate provisional lines and say provisional/TBC in the description — do not collapse into one lot.",
    "Split strip-out and install into separate cost centres when both apply.",
    "For removal / strip-out / rip-out cost centres, ONLY include isolation and disposal materials: stop ends, caps, temporary isolation valves, drain-offs, waste sacks, PTFE.",
    "NEVER put copper tube metreage, elbows, tees, couplings, pipe clips, solder, flux, inhibitor or new pipework fittings in a removal centre — those belong in the installation / renew centre.",
    "Also return clarifyingQuestions[{key,question,why}] for anything still unclear that would change materials, labour or exclusions.",
    "Ask only unanswered commercial/site questions. Skip anything already answered in answeredBuddyChecks.",
    "If the description is clear enough, clarifyingQuestions can be an empty array.",
    "Do not invent prices. Return JSON only with keys summary, costCentres and clarifyingQuestions.",
    JSON.stringify(context),
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return strict JSON only. Materials must be itemised merchant lines, never lots. Removal/strip-out centres get caps and isolation only — never pipe metreage. Ask clarifyingQuestions when unsure." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof (body as { error?: { message?: string } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : `OpenAI HTTP ${response.status}`;
      const shortDetail = /quota|billing/i.test(detail)
        ? "OpenAI quota or billing limit reached on this API key. Top up or change plan at platform.openai.com/account/billing, then try again."
        : detail;
      return {
        connected: true,
        aiUsed: false,
        error: shortDetail,
        pack: fallbackCostCentres(survey, `OpenAI key is present, but Blake could not build the pack (${shortDetail}). Showing a rule-based draft instead.`),
      };
    }
    const text = extractChatText(body) || getOutputText(body);
    if (!text) {
      return {
        connected: true,
        aiUsed: false,
        error: "Empty OpenAI response",
        pack: fallbackCostCentres(survey, "OpenAI responded with an empty pack. Showing a rule-based draft instead."),
      };
    }
    const parsed = JSON.parse(text) as { summary?: string; costCentres?: unknown; clarifyingQuestions?: unknown };
    const costCentres = normaliseCostCentres(parsed.costCentres, survey.customerRequirements);
    if (!costCentres.length) {
      return {
        connected: true,
        aiUsed: false,
        error: "No cost centres in OpenAI JSON",
        pack: fallbackCostCentres(survey, "OpenAI returned no usable cost centres. Showing a rule-based draft instead."),
      };
    }
    return {
      connected: true,
      aiUsed: true,
      pack: {
        summary: typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "AI cost centres prepared with itemised materials for supplier RFQ.",
        costCentres,
        clarifyingQuestions: normaliseClarifyingQuestions(parsed.clarifyingQuestions, survey.customerRequirements, answeredKeys),
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "OpenAI request failed";
    return {
      connected: true,
      aiUsed: false,
      error: detail,
      pack: fallbackCostCentres(survey, `Blake hit an error talking to OpenAI (${detail}). Showing a rule-based draft instead.`),
    };
  }
}

function labourRates() {
  const finance = getHubDetailState().financeSettings || {};
  const labourRatesList = Array.isArray(finance.labourRates)
    ? finance.labourRates.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
  const findRate = (pattern: RegExp) => labourRatesList.find((item) => pattern.test(`${item.id || ""} ${item.name || ""}`));
  const engineer = findRate(/engineer|plumber/i);
  const joiner = findRate(/joiner/i);
  const electrician = findRate(/electric/i);
  const numberSetting = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    Plumber: { cost: numberSetting(engineer?.costRate, 40), sell: numberSetting(engineer?.sellRate, 65) },
    Joiner: { cost: numberSetting(joiner?.costRate, 30), sell: numberSetting(joiner?.sellRate, 55) },
    Electrician: { cost: numberSetting(electrician?.costRate, 40), sell: numberSetting(electrician?.sellRate, 70) },
    Other: { cost: 35, sell: 60 },
  } as const;
}

function linesFromCostCentres(costCentres: QuickCostCentre[], surveyId: string) {
  const rates = labourRates();
  const materialLines: EstimateMaterialLine[] = [];
  const labourLines: EstimateLabourLine[] = [];
  const scopeOfWorks: string[] = [];

  costCentres.forEach((centre) => {
    scopeOfWorks.push(`${centre.name}: ${centre.jobDescription}`);
    centre.materials.forEach((material) => {
      materialLines.push({
        id: makeId("est-mat"),
        costCentre: centre.name,
        trade: centre.trade,
        description: material.description,
        quantity: material.quantity,
        unit: material.unit,
        markupPercent: 0,
        status: "Supplier RFQ",
        sourceType: "Manual",
        sourceId: surveyId,
        calculationExplanation: "Listed for supplier quote request. No unit cost applied.",
        notes: "Send on supplier quote request form.",
      });
    });
    centre.labour.forEach((labour) => {
      const key = /electr/i.test(labour.trade)
        ? "Electrician"
        : /join/i.test(labour.trade)
          ? "Joiner"
          : /plumb|heat|engineer/i.test(labour.trade)
            ? "Plumber"
            : "Other";
      const rate = rates[key];
      labourLines.push({
        id: makeId("est-lab"),
        costCentre: centre.name,
        trade: labour.trade,
        labourType: key,
        description: labour.description,
        hours: labour.hours,
        costRate: rate.cost,
        sellRate: rate.sell,
        status: "Allowance",
        calculationBasis: "Suggested labour allowance from works description.",
        sourceType: "Manual",
        sourceId: surveyId,
        notes: "Review before issuing.",
      });
    });
  });

  return { materialLines, labourLines, scopeOfWorks };
}

function takeoffRowsFromCostCentres(costCentres: QuickCostCentre[]) {
  const materials: TakeoffMaterialAllowance[] = [];
  const labour: TakeoffLabourAllowance[] = [];
  const supplierRequests: TakeoffSupplierRequestItem[] = [];
  const rates = labourRates();

  costCentres.forEach((centre) => {
    const normalised = ensureItemisedMaterials(centre, `${centre.name} ${centre.jobDescription}`);
    normalised.materials.forEach((material) => {
      const materialId = makeId("survey-mat");
      materials.push({
        id: materialId,
        section: normalised.name,
        description: material.description,
        quantity: material.quantity,
        unit: material.unit,
        unitCost: 0,
        markupPercent: 0,
        supplierRequired: true,
      });
      supplierRequests.push({
        id: makeId("survey-rfq"),
        supplier: "To confirm",
        description: material.description,
        quantity: material.quantity,
        unit: material.unit,
        linkedMaterialId: materialId,
        notes: `${normalised.name} · supplier quote request`,
      });
    });
    normalised.labour.forEach((item) => {
      const key = /electr/i.test(item.trade)
        ? "Electrician"
        : /join/i.test(item.trade)
          ? "Joiner"
          : "Plumber";
      labour.push({
        id: makeId("survey-lab"),
        section: normalised.name,
        role: item.trade || key,
        hours: item.hours,
        costRate: rates[key].cost,
        markupPercent: 0,
        notes: item.description,
      });
    });
  });

  return { materials, labour, supplierRequests };
}

function mergeTakeoffRows(
  existing: {
    materialAllowances: TakeoffMaterialAllowance[];
    labourAllowances: TakeoffLabourAllowance[];
    supplierRequests: TakeoffSupplierRequestItem[];
    servicesMarkup?: TakeoffServicesMarkup;
  },
  next: {
    materials: TakeoffMaterialAllowance[];
    labour: TakeoffLabourAllowance[];
    supplierRequests: TakeoffSupplierRequestItem[];
  },
) {
  const packages = existing.servicesMarkup?.packages;
  const keepMaterials = existing.materialAllowances.filter((line) => (
    line.id.startsWith("markup-material")
    || line.id.startsWith("markup-symbol-material")
    || line.id.startsWith("markup-package-material")
  ));
  const keepLabour = existing.labourAllowances.filter((line) => line.id.startsWith("markup-labour"));
  const keepSupplier = existing.supplierRequests.filter((line) => (
    line.id.startsWith("markup-")
    || line.notes === "From Services Markup"
    || line.notes === "From Markup package"
    || keepMaterials.some((material) => material.id === line.linkedMaterialId)
  ));
  const nextMaterials = filterSurveyMaterialsCoveredByPackages(next.materials, packages);
  const keptIds = new Set([
    ...keepMaterials.map((line) => line.id),
    ...nextMaterials.map((line) => line.id),
  ]);
  const nextSupplier = filterSupplierRequestsForKeptMaterials(next.supplierRequests, keptIds, packages);
  return {
    materialAllowances: [...nextMaterials, ...keepMaterials],
    labourAllowances: [...next.labour, ...keepLabour],
    supplierRequests: [...nextSupplier, ...keepSupplier],
  };
}

function documentsFromSurveyPhotos(survey: SurveyRecord, existingDocuments: TakeoffDocument[]) {
  const existingKeys = new Set(existingDocuments.map((document) => document.storageKey).filter(Boolean));
  const existingNames = new Set(existingDocuments.map((document) => document.fileName.toLowerCase()));
  return survey.photos.flatMap((photo) => {
    if (!photo.storageKey) return [];
    if (existingKeys.has(photo.storageKey) || existingNames.has(photo.fileName.toLowerCase())) return [];
    const isScan = /lidar|roomplan|room scan|\.json|\.usd|\.usdz|\.obj|\.glb|\.gltf|\.ply|model\//i
      .test(`${photo.fileName} ${photo.mimeType} ${photo.caption}`);
    const isDrawing = /\.pdf$/i.test(photo.fileName) || /drawing|plan/i.test(photo.caption);
    const kind: TakeoffDocument["kind"] = isScan ? "LiDAR scan" : isDrawing ? "Drawing" : "Survey photo";
    return [{
      id: makeId("takeoff-doc"),
      kind,
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      size: photo.size,
      storageKey: photo.storageKey,
      uploadedAt: photo.capturedAt || nowIso(),
      status: "Uploaded" as const,
      notes: [
        `Imported from survey ${survey.reference}`,
        photo.caption || photo.category,
      ].filter(Boolean),
    } satisfies TakeoffDocument];
  });
}

function ensureEstimate(
  tenantId: string,
  survey: SurveyRecord,
  costCentres: QuickCostCentre[],
  summary: string,
): EstimateRecord {
  const createdAt = nowIso();
  const { materialLines, labourLines, scopeOfWorks } = linesFromCostCentres(costCentres, survey.id);
  const pricingProfile = seededPricingProfiles.find((profile) => profile.market === survey.market) || seededPricingProfiles[0]!;
  const existing = survey.estimateId ? getEstimate(tenantId, survey.estimateId) : undefined;

  if (existing) {
    return {
      ...existing,
      sourceSurveyVersion: survey.version,
      version: existing.version + 1,
      status: "In review",
      scopeOfWorks,
      questions: [],
      assumptions: existing.assumptions,
      exclusions: existing.exclusions,
      riskNotes: existing.riskNotes,
      materialLines,
      labourLines,
      generationRuns: [
        ...existing.generationRuns,
        {
          id: makeId("est-run"),
          startedAt: createdAt,
          completedAt: createdAt,
          sourceSurveyVersion: survey.version,
          ruleVersion: "survey-quick-cost-centres-v1",
          summary,
        },
      ].slice(-100),
      updatedAt: createdAt,
    };
  }

  return {
    id: makeId("estimate"),
    tenantId,
    reference: `EST-${Date.now().toString().slice(-6)}`,
    surveyId: survey.id,
    sourceSurveyVersion: survey.version,
    version: 1,
    status: "In review",
    pricingProfile: clone(pricingProfile),
    scopeOfWorks,
    questions: [],
    assumptions: [],
    exclusions: [],
    riskNotes: [],
    materialLines,
    labourLines,
    corrections: [],
    generationRuns: [{
      id: makeId("est-run"),
      startedAt: createdAt,
      completedAt: createdAt,
      sourceSurveyVersion: survey.version,
      ruleVersion: "survey-quick-cost-centres-v1",
      summary,
    }],
    simproMappings: clone(seededSimproEstimateMappings),
    createdAt,
    updatedAt: createdAt,
  };
}

export async function buildQuickCostCentrePack(
  tenantId: string,
  surveyId: string,
  actor: string,
  expectedVersion?: number,
): Promise<QuickPackResult> {
  let survey = getSurvey(tenantId, surveyId);
  if (!survey) {
    return { ok: false, status: 404, costCentres: [], clarifyingQuestions: [], aiUsed: false, aiConnected: false, summary: "", error: "Survey not found." };
  }
  if (!survey.customerRequirements.trim()) {
    return {
      ok: false,
      status: 422,
      survey,
      costCentres: [],
      clarifyingQuestions: clarifyingQuestionsForWorks("", new Set()),
      aiUsed: false,
      aiConnected: getTakeoffOpenAiConfig().connected,
      aiModel: getTakeoffOpenAiConfig().model,
      summary: "",
      error: "Add a description of the works before generating cost centres.",
    };
  }

  const suggestedJobType = inferSurveyJobTypeFromText(survey.customerRequirements);
  const patch: Partial<SurveyRecord> = {};
  if (suggestedJobType && suggestedJobType !== survey.jobType) patch.jobType = suggestedJobType;
  if (!survey.customerName.trim()) patch.customerName = "Customer to confirm";
  if (!survey.siteAddress.trim()) patch.siteAddress = "Site to confirm";
  if (!survey.surveyorName.trim()) patch.surveyorName = actor;
  if (!survey.surveyDate) patch.surveyDate = nowIso().slice(0, 10);
  // Do not invent a fake Lead jobLink — that breaks Send to quote (only real Quote links update Core).
  if (!survey.scopeItems.length) {
    patch.scopeItems = [{
      id: makeId("survey-scope"),
      taskType: survey.customerRequirements.slice(0, 80) || "Described works",
      trade: "Plumbing/Heating",
      roomOrArea: "",
      existingPosition: "",
      proposedPosition: "",
      quantity: 1,
      dimensions: "",
      status: "Assumed",
      responsibility: "EWG",
      notes: "Created from the quick survey works description.",
      photoIds: [],
    } satisfies SurveyScopeItem];
  }
  if (!survey.surveyIntent) {
    patch.surveyIntent = {
      ...inferSurveyorIntent({
        text: survey.customerRequirements,
        jobType: suggestedJobType || survey.jobType,
        evidenceCount: survey.photos.length,
      }),
      updatedAt: nowIso(),
    };
  }

  if (Object.keys(patch).length) {
    const updated = updateSurvey(tenantId, survey.id, patch, expectedVersion ?? survey.version, actor, {
      action: "Quick pack prepared",
      detail: "Filled the minimum fields needed for a cost-centre pack.",
    });
    if (!updated.ok) {
      return {
        ok: false,
        status: updated.reason === "version_conflict" ? 409 : 422,
        survey,
        costCentres: [],
        clarifyingQuestions: [],
        aiUsed: false,
        aiConnected: getTakeoffOpenAiConfig().connected,
        aiModel: getTakeoffOpenAiConfig().model,
        summary: "",
        error: updated.message || "Unable to prepare the survey for a quick pack.",
      };
    }
    survey = updated.value;
  }

  const { pack, aiUsed, connected, error: aiError } = await generateCostCentresWithAi(survey);
  const openAi = getTakeoffOpenAiConfig();
  const clarifyingQuestions = Array.isArray(pack.clarifyingQuestions)
    ? pack.clarifyingQuestions
    : clarifyingQuestionsForWorks(
      survey.customerRequirements,
      new Set(survey.answers.filter((answer) => String(answer.value || "").trim()).map((answer) => answer.key)),
    );
  const mergedAnswers = mergeBuddyAnswers(survey, clarifyingQuestions);
  if (JSON.stringify(mergedAnswers) !== JSON.stringify(survey.answers)) {
    const withAnswers = updateSurvey(tenantId, survey.id, { answers: mergedAnswers }, survey.version, actor, {
      action: "Blake checks prepared",
      detail: clarifyingQuestions.length
        ? `Blake asked ${clarifyingQuestions.length} clarifying question(s).`
        : "Blake had no further clarifying questions.",
    });
    if (withAnswers.ok) survey = withAnswers.value;
  }

  const estimate = ensureEstimate(tenantId, survey, pack.costCentres, pack.summary);
  saveEstimateRecord(tenantId, estimate);

  const takeoffRows = takeoffRowsFromCostCentres(pack.costCentres);
  let takeoffProjectId = survey.legacyTakeoffProjectId;
  let takeoff = takeoffProjectId ? getTakeoffProject(takeoffProjectId) : null;
  const linkedQuoteId = survey.jobLink?.type === "Quote" ? survey.jobLink.id : undefined;
  if (!takeoff) {
    const importedDocuments = documentsFromSurveyPhotos(survey, []);
    takeoff = createTakeoffProject({
      name: `${survey.reference} takeoff`,
      customer: survey.customerName,
      site: survey.siteAddress,
      description: survey.customerRequirements,
      linkedQuoteId,
      documents: importedDocuments,
      materialAllowances: takeoffRows.materials,
      labourAllowances: takeoffRows.labour,
      supplierRequests: takeoffRows.supplierRequests,
      review: {
        officeNotes: pack.summary,
        riskFlags: [],
      },
    });
    takeoffProjectId = takeoff.id;
  } else {
    const merged = mergeTakeoffRows(takeoff, takeoffRows);
    const importedDocuments = documentsFromSurveyPhotos(survey, takeoff.documents);
    takeoff = updateTakeoffProject(takeoff.id, {
      customer: survey.customerName || takeoff.customer,
      site: survey.siteAddress || takeoff.site,
      description: survey.customerRequirements || takeoff.description,
      ...(linkedQuoteId ? { linkedQuoteId } : {}),
      documents: [...takeoff.documents, ...importedDocuments],
      materialAllowances: merged.materialAllowances,
      labourAllowances: merged.labourAllowances,
      supplierRequests: merged.supplierRequests,
      review: {
        ...takeoff.review,
        officeNotes: pack.summary,
      },
    }) || takeoff;
    takeoffProjectId = takeoff.id;
  }

  const linked = attachQuickPackToSurvey(tenantId, survey.id, {
    estimateId: estimate.id,
    takeoffProjectId,
    expectedVersion: survey.version,
    actor,
    detail: pack.summary,
  });
  if (!linked.ok) {
    return {
      ok: false,
      status: linked.reason === "version_conflict" ? 409 : 422,
      survey,
      estimateId: estimate.id,
      estimateReference: estimate.reference,
      takeoffProjectId,
      costCentres: pack.costCentres,
      clarifyingQuestions,
      aiUsed,
      aiConnected: connected,
      aiModel: openAi.model,
      summary: pack.summary,
      error: linked.message || aiError || "Cost centres were built, but the survey link could not be saved.",
    };
  }

  return {
    ok: true,
    status: 200,
    survey: linked.value,
    estimateId: estimate.id,
    estimateReference: estimate.reference,
    takeoffProjectId,
    costCentres: pack.costCentres,
    clarifyingQuestions,
    aiUsed,
    aiConnected: connected,
    aiModel: openAi.model,
    summary: pack.summary,
    error: aiUsed ? undefined : aiError,
  };
}
