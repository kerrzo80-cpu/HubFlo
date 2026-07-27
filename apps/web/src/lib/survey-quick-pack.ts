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
  type TakeoffSupplierRequestItem,
} from "@/lib/takeoff-data";
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

export type QuickPackResult = {
  ok: boolean;
  status: number;
  survey?: SurveyRecord;
  estimateId?: string;
  estimateReference?: string;
  takeoffProjectId?: string;
  costCentres: QuickCostCentre[];
  aiUsed: boolean;
  aiConnected: boolean;
  aiModel?: string;
  summary: string;
  error?: string;
};

type AiQuickPack = {
  summary: string;
  costCentres: QuickCostCentre[];
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

function normaliseCostCentres(raw: unknown): QuickCostCentre[] {
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
            unit: String(row.unit || "nr").trim() || "nr",
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
      return {
        name: String(item.name || "").trim(),
        jobDescription: String(item.jobDescription || "").trim(),
        trade: normaliseTrade(item.trade),
        materials,
        labour,
      };
    })
    .filter((item) => item.name && item.jobDescription);
}

function fallbackCostCentres(survey: SurveyRecord, reason: string): AiQuickPack {
  const intent = inferSurveyorIntent({
    text: survey.customerRequirements,
    jobType: survey.jobType,
    currentIntent: survey.surveyIntent,
    evidenceCount: survey.photos.length,
  });
  const path = buildDynamicSurveyPath(intent);
  const name = `${path.intent.itemGroup} ${path.intent.workType}`.trim() || survey.jobType;
  return {
    summary: reason,
    costCentres: [
      {
        name,
        jobDescription: survey.customerRequirements.trim() || `Carry out ${name.toLowerCase()} as described on site evidence.`,
        trade: "Plumbing/Heating",
        materials: path.materialBuild.slice(0, 8).map((item) => ({
          description: item,
          quantity: 1,
          unit: "nr",
        })),
        labour: path.labourBuild.slice(0, 4).map((item) => ({
          description: item,
          hours: 2,
          trade: /electr/i.test(item) ? "Electrician" : /join/i.test(item) ? "Joiner" : "Plumber",
        })),
      },
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

  const model = openAi.model || "gpt-4.1-mini";
  const context = {
    reference: survey.reference,
    jobType: survey.jobType,
    customerRequirements: survey.customerRequirements,
    customerName: survey.customerName,
    siteAddress: survey.siteAddress,
    evidenceCount: survey.photos.length,
    photos: survey.photos.slice(0, 20).map((photo) => ({
      category: photo.category,
      caption: photo.caption,
      fileName: photo.fileName,
    })),
  };

  const prompt = [
    "You are Buddy building a simple NeXa estimating pack for UK plumbing and heating.",
    "From the works description and evidence metadata, propose cost centres.",
    "Each cost centre needs name, jobDescription, trade, materials[{description,quantity,unit}], labour[{description,hours,trade}].",
    "Do not invent prices. Materials will go on a supplier quote request.",
    "Return JSON only with keys summary and costCentres.",
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
          { role: "system", content: "Return strict JSON only for NeXa cost centres." },
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
        pack: fallbackCostCentres(survey, `OpenAI key is present, but Buddy could not build the pack (${shortDetail}). Showing a rule-based draft instead.`),
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
    const parsed = JSON.parse(text) as { summary?: string; costCentres?: unknown };
    const costCentres = normaliseCostCentres(parsed.costCentres);
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
          : "AI cost centres prepared from the works description and evidence.",
        costCentres,
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "OpenAI request failed";
    return {
      connected: true,
      aiUsed: false,
      error: detail,
      pack: fallbackCostCentres(survey, `Buddy hit an error talking to OpenAI (${detail}). Showing a rule-based draft instead.`),
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
    centre.materials.forEach((material) => {
      const materialId = makeId("survey-mat");
      materials.push({
        id: materialId,
        section: centre.name,
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
        notes: `${centre.name} · supplier quote request`,
      });
    });
    centre.labour.forEach((item) => {
      const key = /electr/i.test(item.trade)
        ? "Electrician"
        : /join/i.test(item.trade)
          ? "Joiner"
          : "Plumber";
      labour.push({
        id: makeId("survey-lab"),
        section: centre.name,
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
  },
  next: {
    materials: TakeoffMaterialAllowance[];
    labour: TakeoffLabourAllowance[];
    supplierRequests: TakeoffSupplierRequestItem[];
  },
) {
  const keepMaterials = existing.materialAllowances.filter((line) => (
    line.id.startsWith("markup-material")
    || line.id.startsWith("markup-symbol-material")
  ));
  const keepLabour = existing.labourAllowances.filter((line) => line.id.startsWith("markup-labour"));
  const keepSupplier = existing.supplierRequests.filter((line) => (
    line.id.startsWith("markup-")
    || keepMaterials.some((material) => material.id === line.linkedMaterialId)
  ));
  return {
    materialAllowances: [...next.materials, ...keepMaterials],
    labourAllowances: [...next.labour, ...keepLabour],
    supplierRequests: [...next.supplierRequests, ...keepSupplier],
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
    return { ok: false, status: 404, costCentres: [], aiUsed: false, aiConnected: false, summary: "", error: "Survey not found." };
  }
  if (!survey.customerRequirements.trim()) {
    return {
      ok: false,
      status: 422,
      survey,
      costCentres: [],
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
  if (!survey.jobLink) {
    patch.jobLink = {
      type: "Lead",
      id: `quick-${survey.id}`,
      reference: survey.reference,
    };
  }
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
  const estimate = ensureEstimate(tenantId, survey, pack.costCentres, pack.summary);
  saveEstimateRecord(tenantId, estimate);

  const takeoffRows = takeoffRowsFromCostCentres(pack.costCentres);
  let takeoffProjectId = survey.legacyTakeoffProjectId;
  let takeoff = takeoffProjectId ? getTakeoffProject(takeoffProjectId) : null;
  if (!takeoff) {
    const importedDocuments = documentsFromSurveyPhotos(survey, []);
    takeoff = createTakeoffProject({
      name: `${survey.reference} takeoff`,
      customer: survey.customerName,
      site: survey.siteAddress,
      description: survey.customerRequirements,
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
    aiUsed,
    aiConnected: connected,
    aiModel: openAi.model,
    summary: pack.summary,
    error: aiUsed ? undefined : aiError,
  };
}
