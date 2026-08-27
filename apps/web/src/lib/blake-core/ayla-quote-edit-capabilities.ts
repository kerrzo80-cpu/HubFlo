import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import {
  getEstimates,
  recordEstimateQuotePush,
  updateEstimateLine,
} from "@/lib/survey-estimator-store";
import { getQuotes, updateQuote } from "@/lib/workflow-data";

import type { BlakeCapability } from "./types";

type QuoteBuildLine = {
  id?: string;
  description?: string;
  quantity?: number;
  unitCost?: number;
  unitSell?: number;
  internalOnly?: boolean;
  lineType?: "material" | "labour" | string;
};

type QuoteBuildCentre = {
  id?: string;
  name?: string;
  clientDescription?: string;
  lines?: QuoteBuildLine[];
};

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

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sameRef(left: string, right: string) {
  return left.trim().toLowerCase().replace(/\s+/g, "-") === right.trim().toLowerCase().replace(/\s+/g, "-");
}

function findQuote(value: string) {
  const target = value.trim();
  return getQuotes().find((quote) => quote.id === target || sameRef(quote.ref, target));
}

function quoteCentres(quoteId: string) {
  const map = (getHubDetailState().quoteCostCentres || {}) as Record<string, unknown>;
  const raw = map[quoteId];
  return Array.isArray(raw) ? raw as QuoteBuildCentre[] : [];
}

function lineTotal(line: QuoteBuildLine) {
  return (Number(line.quantity) || 0) * (Number(line.unitSell) || 0);
}

function centreTotal(centre: QuoteBuildCentre) {
  return (centre.lines || []).reduce((sum, line) => sum + lineTotal(line), 0);
}

function updateQuoteCentres(quoteId: string, centres: QuoteBuildCentre[]) {
  const hub = getHubDetailState();
  saveHubDetailState({
    ...hub,
    quoteCostCentres: {
      ...(hub.quoteCostCentres || {}),
      [quoteId]: centres,
    },
  });
}

function estimateForQuote(tenantId: string, quoteId: string, quoteRef: string, lineId: string) {
  return getEstimates(tenantId).find((estimate) =>
    (estimate.coreQuoteId === quoteId || estimate.coreQuoteRef === quoteRef)
    && (estimate.labourLines.some((line) => line.id === lineId) || estimate.materialLines.some((line) => line.id === lineId)),
  );
}

export const readQuoteBuildUpCapability: BlakeCapability = {
  definition: definition({
    name: "read_quote_build_up",
    description: "Read the authorised internal labour/material build-up under a Blake quote's room cost centres. Use this before changing hours, quantities or prices. This internal detail is for office conversation and is not the client-facing quote presentation.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showQuotes"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { quote: { type: "string" } },
      required: ["quote"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { quote: requiredString(raw.quote, "Quote") };
  },
  execute(input) {
    const quote = findQuote(input.quote);
    if (!quote) throw new Error("Quote not found.");
    const centres = quoteCentres(quote.id).map((centre) => ({
      id: centre.id,
      name: centre.name,
      clientDescription: centre.clientDescription,
      sellTotal: Math.round(centreTotal(centre) * 100) / 100,
      lines: (centre.lines || []).map((line) => ({
        id: line.id,
        description: line.description,
        kind: line.lineType || (/^(plumber|joiner|electrician|labour)\s*:/i.test(line.description || "") ? "labour" : "material"),
        quantity: Number(line.quantity) || 0,
        unitCost: Number(line.unitCost) || 0,
        unitSell: Number(line.unitSell) || 0,
        sellTotal: Math.round(lineTotal(line) * 100) / 100,
        internalOnly: line.internalOnly !== false,
      })),
    }));
    return { quote: { id: quote.id, ref: quote.ref, customer: quote.customer, value: quote.value }, centres };
  },
};

export const adjustQuoteLabourCapability: BlakeCapability = {
  definition: definition({
    name: "adjust_quote_labour",
    description: "Change one existing hidden labour line on a Draft Blake quote after reading the build-up. Use the exact line id returned by read_quote_build_up. Supports setting the final hours or applying a positive/negative hour delta. Recalculates the room and whole quote total and mirrors the correction to the linked Estimate where possible.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        quote: { type: "string" },
        lineId: { type: "string" },
        hours: { type: "number", minimum: 0 },
        deltaHours: { type: "number" },
        reason: { type: "string" },
      },
      required: ["quote", "lineId", "reason"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const hours = optionalNumber(raw.hours);
    const deltaHours = optionalNumber(raw.deltaHours);
    if (hours === undefined && deltaHours === undefined) throw new TypeError("Provide hours or deltaHours.");
    if (hours !== undefined && deltaHours !== undefined) throw new TypeError("Provide either hours or deltaHours, not both.");
    if (hours !== undefined && hours < 0) throw new TypeError("Hours cannot be negative.");
    return {
      quote: requiredString(raw.quote, "Quote"),
      lineId: requiredString(raw.lineId, "Labour line id"),
      hours,
      deltaHours,
      reason: requiredString(raw.reason, "Reason"),
    };
  },
  execute(input, context) {
    const quote = findQuote(input.quote);
    if (!quote) throw new Error("Quote not found.");
    if (quote.status !== "Draft") throw new Error("Only Draft quotes can have their internal labour build-up changed by Ayla.");
    const centres = quoteCentres(quote.id);
    let found = false;
    let previousHours = 0;
    let nextHours = 0;
    let room = "";
    const nextCentres = centres.map((centre) => ({
      ...centre,
      lines: (centre.lines || []).map((line) => {
        if (line.id !== input.lineId) return line;
        const isLabour = line.lineType === "labour" || /^(plumber|joiner|electrician|labour)\s*:/i.test(line.description || "");
        if (!isLabour) throw new Error("That line is not a labour line.");
        found = true;
        room = centre.name || "Works";
        previousHours = Number(line.quantity) || 0;
        nextHours = input.hours !== undefined ? input.hours : previousHours + (input.deltaHours || 0);
        if (nextHours < 0) throw new Error("That change would make labour hours negative.");
        return { ...line, quantity: Math.round(nextHours * 100) / 100 };
      }),
    }));
    if (!found) throw new Error("Labour line not found in that quote build-up. Read the quote build-up again first.");

    const total = nextCentres.reduce((sum, centre) => sum + centreTotal(centre), 0);
    updateQuoteCentres(quote.id, nextCentres);
    const updatedQuote = updateQuote(quote.id, { value: Math.round(total * 100) / 100 });
    if (!updatedQuote) throw new Error("Quote total could not be updated.");

    const estimate = estimateForQuote(context.actor.tenantId, quote.id, quote.ref, input.lineId);
    if (estimate) {
      const correction = updateEstimateLine(
        context.actor.tenantId,
        estimate.id,
        estimate.version,
        { lineType: "Labour", lineId: input.lineId, patch: { hours: Math.round(nextHours * 100) / 100 } },
        input.reason,
        context.actor.name,
      );
      if (correction.ok) {
        recordEstimateQuotePush(context.actor.tenantId, correction.value.id, correction.value.version, { id: quote.id, ref: quote.ref });
      }
    }

    return {
      quote: { id: updatedQuote.id, ref: updatedQuote.ref, value: updatedQuote.value },
      room,
      lineId: input.lineId,
      previousHours,
      hours: Math.round(nextHours * 100) / 100,
      changeHours: Math.round((nextHours - previousHours) * 100) / 100,
      reason: input.reason,
    };
  },
};

export const adjustQuoteMaterialCapability: BlakeCapability = {
  definition: definition({
    name: "adjust_quote_material",
    description: "Change one existing hidden material line quantity or unit cost on a Draft Blake quote after reading the build-up. Use the exact line id returned by read_quote_build_up. Recalculates the room and whole quote total and mirrors the correction to the linked Estimate where possible.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        quote: { type: "string" },
        lineId: { type: "string" },
        quantity: { type: "number", minimum: 0 },
        unitCost: { type: "number", minimum: 0 },
        unitSell: { type: "number", minimum: 0 },
        reason: { type: "string" },
      },
      required: ["quote", "lineId", "reason"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const quantity = optionalNumber(raw.quantity);
    const unitCost = optionalNumber(raw.unitCost);
    const unitSell = optionalNumber(raw.unitSell);
    if (quantity === undefined && unitCost === undefined && unitSell === undefined) throw new TypeError("Provide a quantity, unitCost or unitSell change.");
    if ([quantity, unitCost, unitSell].some((value) => value !== undefined && value < 0)) throw new TypeError("Material values cannot be negative.");
    return {
      quote: requiredString(raw.quote, "Quote"),
      lineId: requiredString(raw.lineId, "Material line id"),
      quantity,
      unitCost,
      unitSell,
      reason: requiredString(raw.reason, "Reason"),
    };
  },
  execute(input, context) {
    const quote = findQuote(input.quote);
    if (!quote) throw new Error("Quote not found.");
    if (quote.status !== "Draft") throw new Error("Only Draft quotes can have their internal material build-up changed by Ayla.");
    const centres = quoteCentres(quote.id);
    let found = false;
    let room = "";
    let previous: QuoteBuildLine | undefined;
    let updated: QuoteBuildLine | undefined;
    const nextCentres = centres.map((centre) => ({
      ...centre,
      lines: (centre.lines || []).map((line) => {
        if (line.id !== input.lineId) return line;
        const isLabour = line.lineType === "labour" || /^(plumber|joiner|electrician|labour)\s*:/i.test(line.description || "");
        if (isLabour) throw new Error("That line is a labour line, not a material line.");
        found = true;
        room = centre.name || "Works";
        previous = { ...line };
        updated = {
          ...line,
          quantity: input.quantity ?? line.quantity,
          unitCost: input.unitCost ?? line.unitCost,
          unitSell: input.unitSell ?? line.unitSell,
        };
        return updated;
      }),
    }));
    if (!found || !updated) throw new Error("Material line not found in that quote build-up. Read the quote build-up again first.");

    const total = nextCentres.reduce((sum, centre) => sum + centreTotal(centre), 0);
    updateQuoteCentres(quote.id, nextCentres);
    const updatedQuote = updateQuote(quote.id, { value: Math.round(total * 100) / 100 });
    if (!updatedQuote) throw new Error("Quote total could not be updated.");

    const estimate = estimateForQuote(context.actor.tenantId, quote.id, quote.ref, input.lineId);
    if (estimate) {
      const correction = updateEstimateLine(
        context.actor.tenantId,
        estimate.id,
        estimate.version,
        {
          lineType: "Material",
          lineId: input.lineId,
          patch: {
            quantity: Number(updated.quantity) || 0,
            unitCost: Number(updated.unitCost) || 0,
          },
        },
        input.reason,
        context.actor.name,
      );
      if (correction.ok) {
        recordEstimateQuotePush(context.actor.tenantId, correction.value.id, correction.value.version, { id: quote.id, ref: quote.ref });
      }
    }

    return {
      quote: { id: updatedQuote.id, ref: updatedQuote.ref, value: updatedQuote.value },
      room,
      lineId: input.lineId,
      previous,
      updated,
      reason: input.reason,
    };
  },
};

export const aylaQuoteEditCapabilities: BlakeCapability[] = [
  readQuoteBuildUpCapability,
  adjustQuoteLabourCapability,
  adjustQuoteMaterialCapability,
];
