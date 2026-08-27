import { surveyJobTypes, type SurveyRoom, type SurveyScopeItem } from "@hubflo/domain";

import { buildAylaRoomQuoteFromEstimate } from "@/lib/ayla-room-quote";
import { buildAiQuotePack } from "@/lib/survey-ai-quote-pack";
import {
  createSurvey,
  getEstimate,
  getSurvey,
  getSurveyCompletionReview,
  updateSurvey,
  upsertSurveyItem,
} from "@/lib/survey-estimator-store";

import type { BlakeCapability } from "./types";

function definition(input: Omit<BlakeCapability["definition"], "version">): BlakeCapability["definition"] {
  return { ...input, version: 1 };
}

function objectInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Capability input must be an object.");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function optionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const startSurveyCapability: BlakeCapability = {
  definition: definition({
    name: "start_survey",
    description: "Start an internal Ayla survey linked to a Blake customer/job/quote. Use this when the user says they are surveying a room, job or property. This does not create a client document.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        customerName: { type: "string" },
        siteAddress: { type: "string" },
        customerRequirements: { type: "string" },
        jobType: { type: "string", enum: surveyJobTypes },
        market: { type: "string", enum: ["Domestic", "Commercial"] },
        customerId: { type: "string" },
        siteId: { type: "string" },
        linkType: { type: "string", enum: ["Lead", "Quote", "Job"] },
        linkId: { type: "string" },
        linkReference: { type: "string" },
      },
      required: ["customerName", "siteAddress", "customerRequirements", "jobType"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const jobType = requiredString(raw.jobType, "Job type");
    if (!surveyJobTypes.includes(jobType as (typeof surveyJobTypes)[number])) throw new TypeError("Job type is not supported.");
    return {
      customerName: requiredString(raw.customerName, "Customer name"),
      siteAddress: requiredString(raw.siteAddress, "Site address"),
      customerRequirements: requiredString(raw.customerRequirements, "Customer requirements"),
      jobType: jobType as (typeof surveyJobTypes)[number],
      market: raw.market === "Commercial" ? "Commercial" as const : "Domestic" as const,
      customerId: optionalString(raw.customerId),
      siteId: optionalString(raw.siteId),
      linkType: ["Lead", "Quote", "Job"].includes(String(raw.linkType)) ? String(raw.linkType) as "Lead" | "Quote" | "Job" : undefined,
      linkId: optionalString(raw.linkId),
      linkReference: optionalString(raw.linkReference),
    };
  },
  execute(input, context) {
    return createSurvey({
      customerName: input.customerName,
      siteAddress: input.siteAddress,
      customerRequirements: input.customerRequirements,
      jobType: input.jobType,
      market: input.market,
      customerId: input.customerId,
      siteId: input.siteId,
      surveyorId: context.actor.id,
      surveyorName: context.actor.name,
      surveyDate: new Date().toISOString().slice(0, 10),
      jobLink: input.linkType && input.linkId && input.linkReference
        ? { type: input.linkType, id: input.linkId, reference: input.linkReference }
        : undefined,
    }, { tenantId: context.actor.tenantId, actor: context.actor.name });
  },
};

export const readSurveyCapability: BlakeCapability = {
  definition: definition({
    name: "read_survey",
    description: "Read one Ayla survey by survey id/reference so conversational follow-ups can use the current rooms, scope, measurements, evidence and blockers.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showQuotes"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { survey: { type: "string" } },
      required: ["survey"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { survey: requiredString(raw.survey, "Survey") };
  },
  execute(input, context) {
    const survey = getSurvey(context.actor.tenantId, input.survey);
    if (!survey) throw new Error("Survey not found.");
    return survey;
  },
};

export const setSurveyRoomCapability: BlakeCapability = {
  definition: definition({
    name: "set_survey_room",
    description: "Add or update a room/area and its measured dimensions in the current Ayla survey. Use the room name as the future quote cost-centre name, for example Bathroom or Kitchen.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        survey: { type: "string" },
        roomId: { type: "string" },
        name: { type: "string" },
        lengthM: { type: "number" },
        widthM: { type: "number" },
        heightM: { type: "number" },
        accessNotes: { type: "string" },
      },
      required: ["survey", "name"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      survey: requiredString(raw.survey, "Survey"),
      roomId: optionalString(raw.roomId),
      name: requiredString(raw.name, "Room name"),
      lengthM: numberOrUndefined(raw.lengthM),
      widthM: numberOrUndefined(raw.widthM),
      heightM: numberOrUndefined(raw.heightM),
      accessNotes: optionalString(raw.accessNotes) || "",
    };
  },
  execute(input, context) {
    const survey = getSurvey(context.actor.tenantId, input.survey);
    if (!survey) throw new Error("Survey not found.");
    const existing = survey.rooms.find((room) => room.id === input.roomId || room.name.toLowerCase() === input.name.toLowerCase());
    const room: SurveyRoom = {
      id: existing?.id || `survey-room-${crypto.randomUUID()}`,
      name: input.name,
      lengthM: input.lengthM ?? existing?.lengthM,
      widthM: input.widthM ?? existing?.widthM,
      heightM: input.heightM ?? existing?.heightM,
      wallConstruction: existing?.wallConstruction || "TBC",
      floorConstruction: existing?.floorConstruction || "TBC",
      ceilingConstruction: existing?.ceilingConstruction || "TBC",
      accessNotes: input.accessNotes || existing?.accessNotes || "",
      photoIds: existing?.photoIds || [],
    };
    const result = upsertSurveyItem(context.actor.tenantId, survey.id, "rooms", room, survey.version, context.actor.name);
    if (!result.ok) throw new Error(result.message);
    return result.value;
  },
};

export const addSurveyScopeCapability: BlakeCapability = {
  definition: definition({
    name: "add_survey_scope",
    description: "Add structured work items to the current Ayla survey. Prefer one or more concise scope items tied to a room/area. These become the client-facing bullet points for that room when the quote is built.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        survey: { type: "string" },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              taskType: { type: "string" },
              roomOrArea: { type: "string" },
              trade: { type: "string" },
              quantity: { type: "number" },
              dimensions: { type: "string" },
              existingPosition: { type: "string" },
              proposedPosition: { type: "string" },
              notes: { type: "string" },
              status: { type: "string", enum: ["Confirmed", "Assumed", "Provisional", "TBC"] },
            },
            required: ["taskType", "roomOrArea"],
          },
        },
      },
      required: ["survey", "items"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const items = Array.isArray(raw.items) ? raw.items : [];
    if (!items.length) throw new TypeError("At least one scope item is required.");
    return {
      survey: requiredString(raw.survey, "Survey"),
      items: items.map((value) => {
        const item = objectInput(value);
        return {
          taskType: requiredString(item.taskType, "Task type"),
          roomOrArea: requiredString(item.roomOrArea, "Room / area"),
          trade: optionalString(item.trade) || "Plumbing/Heating",
          quantity: Math.max(1, numberOrUndefined(item.quantity) || 1),
          dimensions: optionalString(item.dimensions) || "",
          existingPosition: optionalString(item.existingPosition) || "",
          proposedPosition: optionalString(item.proposedPosition) || "",
          notes: optionalString(item.notes) || "",
          status: ["Confirmed", "Assumed", "Provisional", "TBC"].includes(String(item.status))
            ? String(item.status) as SurveyScopeItem["status"]
            : "Confirmed" as const,
        };
      }),
    };
  },
  execute(input, context) {
    let survey = getSurvey(context.actor.tenantId, input.survey);
    if (!survey) throw new Error("Survey not found.");
    for (const raw of input.items) {
      const duplicate = survey.scopeItems.find((item) =>
        item.taskType.toLowerCase() === raw.taskType.toLowerCase()
        && item.roomOrArea.toLowerCase() === raw.roomOrArea.toLowerCase(),
      );
      const item: SurveyScopeItem = {
        id: duplicate?.id || `survey-scope-${crypto.randomUUID()}`,
        taskType: raw.taskType,
        trade: raw.trade,
        roomOrArea: raw.roomOrArea,
        existingPosition: raw.existingPosition,
        proposedPosition: raw.proposedPosition,
        quantity: raw.quantity,
        dimensions: raw.dimensions,
        status: raw.status,
        responsibility: duplicate?.responsibility || "EWG",
        notes: raw.notes,
        photoIds: duplicate?.photoIds || [],
      };
      const result = upsertSurveyItem(context.actor.tenantId, survey.id, "scopeItems", item, survey.version, context.actor.name);
      if (!result.ok) throw new Error(result.message);
      survey = result.value;
    }
    return survey;
  },
};

export const reviewSurveyCapability: BlakeCapability = {
  definition: definition({
    name: "review_survey",
    description: "Check the current Ayla survey for genuine completion/pricing blockers and missing information before estimating. Use this instead of asking generic survey questions.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showQuotes"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { survey: { type: "string" } },
      required: ["survey"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { survey: requiredString(raw.survey, "Survey") };
  },
  execute(input, context) {
    const review = getSurveyCompletionReview(context.actor.tenantId, input.survey);
    if (!review) throw new Error("Survey not found.");
    return review;
  },
};

export const buildSurveyEstimateCapability: BlakeCapability = {
  definition: definition({
    name: "build_survey_estimate",
    description: "Use the existing Blake Survey/Estimator engine to turn a sufficiently complete Ayla survey into an internal estimate with labour/material build-up. Rates and markups come from Blake settings, not from the language model.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { survey: { type: "string" } },
      required: ["survey"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { survey: requiredString(raw.survey, "Survey") };
  },
  async execute(input, context) {
    const survey = getSurvey(context.actor.tenantId, input.survey);
    if (!survey) throw new Error("Survey not found.");
    const result = await buildAiQuotePack(context.actor.tenantId, survey.id, context.actor.name, survey.version);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        blockers: result.blockers || [],
        summary: result.summary,
        survey: result.survey,
      };
    }
    const estimate = result.estimateId ? getEstimate(context.actor.tenantId, result.estimateId) : undefined;
    return { ...result, estimate };
  },
};

export const buildRoomQuoteCapability: BlakeCapability = {
  definition: definition({
    name: "build_room_quote",
    description: "Create/update the real Blake Draft quote from an internal estimate using Ayla's simple domestic structure: one client-facing cost centre per room/work area, with polished scope bullets and hidden internal labour/material lines. Do not split first fix/second fix/testing into separate cost centres unless the user explicitly asks for that structure.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { estimate: { type: "string" } },
      required: ["estimate"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { estimate: requiredString(raw.estimate, "Estimate") };
  },
  execute(input, context) {
    const estimate = getEstimate(context.actor.tenantId, input.estimate);
    if (!estimate) throw new Error("Estimate not found.");
    return buildAylaRoomQuoteFromEstimate({
      tenantId: context.actor.tenantId,
      estimateId: estimate.id,
      actor: context.actor.name,
      expectedVersion: estimate.version,
    });
  },
};

export const aylaSurveyQuoteCapabilities: BlakeCapability[] = [
  startSurveyCapability,
  readSurveyCapability,
  setSurveyRoomCapability,
  addSurveyScopeCapability,
  reviewSurveyCapability,
  buildSurveyEstimateCapability,
  buildRoomQuoteCapability,
];
