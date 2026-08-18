/**
 * Controlled tools the AI Takeoff assistant may request.
 * NeXa validates and executes; the model never writes BoQ money totals itself.
 */

import {
  calculateHouseTypeTotal,
  calculateProjectTotals,
  findDuplicateTakeoffLines,
  validatePlotRegister,
} from "@/lib/ai-takeoff-calc";
import type { AiTakeoffLine, AiTakeoffPhase, TenderAiTakeoffState } from "@/lib/ai-takeoff-assistant-types";
import {
  addAiTakeoffAssumption,
  getTenderAiTakeoffState,
  makeAiTakeoffLineId,
  saveTenderAiTakeoffState,
  setAiTakeoffHouseTypes,
  setAiTakeoffPlots,
  upsertAiTakeoffLines,
} from "@/lib/ai-takeoff-store";

export const AI_TAKEOFF_TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "create_house_type",
    description: "Register one or more house types for this tender takeoff.",
    parameters: {
      type: "object",
      properties: {
        houseTypes: { type: "array", items: { type: "string" } },
      },
      required: ["houseTypes"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "assign_plots",
    description: "Set the plot register: each plot mapped to a house type.",
    parameters: {
      type: "object",
      properties: {
        plots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              plot: { type: "string" },
              houseType: { type: "string" },
            },
            required: ["plot", "houseType"],
            additionalProperties: false,
          },
        },
      },
      required: ["plots"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "add_takeoff_item",
    description: "Add a measured takeoff line (quantity only — NeXa calculates money).",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        quantity: { type: "number" },
        unit: { type: "string" },
        houseType: { type: "string" },
        plotNumber: { type: "string" },
        costCentre: { type: "string" },
        phase: { type: "string", enum: ["1st fix", "2nd fix", "commissioning", "return visit", "general"] },
        ref: { type: "string" },
        unitCost: { type: "number" },
        markupPercent: { type: "number" },
        labourHours: { type: "number" },
        sourceDocument: { type: "string" },
        confidence: { type: "string", enum: ["High", "Medium", "Low"] },
      },
      required: ["description", "quantity", "unit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_takeoff_item",
    description: "Update an existing proposed takeoff line by id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        description: { type: "string" },
        quantity: { type: "number" },
        unit: { type: "string" },
        unitCost: { type: "number" },
        labourHours: { type: "number" },
        status: { type: "string", enum: ["proposed", "accepted", "rejected"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "record_assumption",
    description: "Record an estimating assumption, exclusion, or tender query.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["assumption", "exclusion", "query"] },
        text: { type: "string" },
      },
      required: ["kind", "text"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "calculate_house_total",
    description: "Ask NeXa to calculate sell/cost totals for a house type from current lines.",
    parameters: {
      type: "object",
      properties: { houseType: { type: "string" } },
      required: ["houseType"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "validate_plot_register",
    description: "Validate plots for duplicates, blanks, and missing house-type coverage.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "generate_nexa_import",
    description: "Summarise accepted lines ready to import into the tender BoQ (does not write yet).",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

type ToolArgs = Record<string, unknown>;

function asNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function executeAiTakeoffTool(
  tenderId: string,
  name: string,
  args: ToolArgs,
): { ok: boolean; message: string; state: TenderAiTakeoffState } {
  let state = getTenderAiTakeoffState(tenderId);

  switch (name) {
    case "create_house_type": {
      const houseTypes = Array.isArray(args.houseTypes)
        ? args.houseTypes.map((row) => asString(row)).filter(Boolean)
        : [];
      if (!houseTypes.length) return { ok: false, message: "No house types provided.", state };
      state = setAiTakeoffHouseTypes(tenderId, [...state.houseTypes, ...houseTypes]);
      return { ok: true, message: `House types now: ${state.houseTypes.join(", ")}`, state };
    }
    case "assign_plots": {
      const plots = Array.isArray(args.plots)
        ? args.plots.map((row) => {
            const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
            return { plot: asString(item.plot), houseType: asString(item.houseType) };
          }).filter((row) => row.plot)
        : [];
      state = setAiTakeoffPlots(tenderId, plots);
      const errors = validatePlotRegister(state.plots, state.houseTypes);
      return {
        ok: errors.length === 0,
        message: errors.length
          ? `Plots saved with warnings: ${errors.join(" ")}`
          : `Assigned ${state.plots.length} plots.`,
        state,
      };
    }
    case "add_takeoff_item": {
      const description = asString(args.description);
      if (!description) return { ok: false, message: "description is required.", state };
      const line: AiTakeoffLine = {
        id: makeAiTakeoffLineId(),
        revisionId: state.activeRevisionId,
        status: "proposed",
        kind: "measured",
        description,
        quantity: asNumber(args.quantity),
        unit: asString(args.unit) || "nr",
        houseType: asString(args.houseType) || undefined,
        plotNumber: asString(args.plotNumber) || undefined,
        costCentre: asString(args.costCentre) || undefined,
        phase: (asString(args.phase) as AiTakeoffPhase) || "general",
        ref: asString(args.ref) || undefined,
        unitCost: asNumber(args.unitCost),
        markupPercent: asNumber(args.markupPercent, state.pricingRules.materialsMarkupPercent),
        labourHours: asNumber(args.labourHours),
        labourRate: state.pricingRules.labourRatePerHour,
        sourceDocument: asString(args.sourceDocument) || undefined,
        confidence: (asString(args.confidence) as "High" | "Medium" | "Low") || "Medium",
        updatedAt: new Date().toISOString(),
      };
      state = upsertAiTakeoffLines(tenderId, [line]);
      return { ok: true, message: `Added line ${line.id}: ${description} × ${line.quantity} ${line.unit}`, state };
    }
    case "update_takeoff_item": {
      const id = asString(args.id);
      const existing = state.lines.find((line) => line.id === id);
      if (!existing) return { ok: false, message: `Line ${id} not found.`, state };
      const next: AiTakeoffLine = {
        ...existing,
        description: asString(args.description) || existing.description,
        quantity: args.quantity !== undefined ? asNumber(args.quantity) : existing.quantity,
        unit: asString(args.unit) || existing.unit,
        unitCost: args.unitCost !== undefined ? asNumber(args.unitCost) : existing.unitCost,
        labourHours: args.labourHours !== undefined ? asNumber(args.labourHours) : existing.labourHours,
        status: (asString(args.status) as AiTakeoffLine["status"]) || existing.status,
        updatedAt: new Date().toISOString(),
      };
      state = upsertAiTakeoffLines(tenderId, [next]);
      return { ok: true, message: `Updated line ${id}.`, state };
    }
    case "record_assumption": {
      const text = asString(args.text);
      const kind = asString(args.kind) as "assumption" | "exclusion" | "query";
      if (!text || !kind) return { ok: false, message: "kind and text required.", state };
      state = addAiTakeoffAssumption(tenderId, { kind, text, status: "open" });
      return { ok: true, message: `Recorded ${kind}: ${text}`, state };
    }
    case "calculate_house_total": {
      const houseType = asString(args.houseType);
      const totals = calculateHouseTypeTotal(state.lines, houseType, state.pricingRules);
      return {
        ok: true,
        message: `${houseType || "All"}: ${totals.lineCount} lines, cost £${totals.totalCost.toFixed(2)}, sell £${totals.totalSell.toFixed(2)}, labour ${totals.labourHours}h`,
        state,
      };
    }
    case "validate_plot_register": {
      const errors = [
        ...validatePlotRegister(state.plots, state.houseTypes),
        ...findDuplicateTakeoffLines(state.lines),
      ];
      return {
        ok: errors.length === 0,
        message: errors.length ? errors.join(" ") : "Plot register and lines look clean.",
        state,
      };
    }
    case "generate_nexa_import": {
      const accepted = state.lines.filter((line) => line.status === "accepted" || line.status === "proposed");
      const project = calculateProjectTotals(accepted, state.plots, state.pricingRules);
      return {
        ok: true,
        message: `Ready to import ${accepted.length} lines across ${state.plots.length} plots. Project sell £${project.totalSell.toFixed(2)} + VAT £${project.vat.toFixed(2)} = £${project.grandTotal.toFixed(2)}. Use Apply to BoQ in the UI to write.`,
        state,
      };
    }
    default:
      return { ok: false, message: `Unknown tool: ${name}`, state };
  }
}

export function patchAiTakeoffLinkedProject(tenderId: string, linkedTakeoffId?: string, conversationId?: string) {
  const state = getTenderAiTakeoffState(tenderId);
  if (linkedTakeoffId) state.linkedTakeoffId = linkedTakeoffId;
  if (conversationId) state.openaiConversationId = conversationId;
  return saveTenderAiTakeoffState(state);
}
