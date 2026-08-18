/**
 * Controlled tools Blake may request for tender takeoff.
 * NeXa validates and executes; the model never writes BoQ money totals itself.
 */

import { softGuideUnitCost } from "@/lib/ai-soft-guide-prices";
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
  replaceAiTakeoffLinesFromSource,
  saveTenderAiTakeoffState,
  setAiTakeoffHouseTypes,
  setAiTakeoffPlots,
  updateAiTakeoffPricingRules,
  upsertAiTakeoffLines,
  dedupeAiTakeoffLines,
} from "@/lib/ai-takeoff-store";
import { getRecordDocument, readRecordDocumentFile } from "@/lib/record-documents";
import { getTender, parseBoqFromWorkbookSheets } from "@/lib/tenders-data";
import { workbookBoqSheetsFromBuffer } from "@/lib/tenders-xlsx";

export const AI_TAKEOFF_TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "set_single_area_project",
    description:
      "Use for commercial / refurb / non-housing tenders (or any single-building job). Creates one area label and one plot so takeoff can proceed WITHOUT housing plot registers. Prefer this when the user says there are no house types or plots.",
    parameters: {
      type: "object",
      properties: {
        areaName: {
          type: "string",
          description: "Area label e.g. Health Club, Plant room, Whole building",
        },
      },
      required: ["areaName"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_house_type",
    description:
      "Register housing plot types OR named zones/areas. For a single commercial building, prefer set_single_area_project instead of inventing fake house types.",
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
    description:
      "Housing plot register only (plot → house type). Skip for single-area commercial projects after set_single_area_project.",
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
    name: "update_pricing_rules",
    description: "Update labour rate (£/h) and materials markup % used when pricing takeoff lines.",
    parameters: {
      type: "object",
      properties: {
        labourRatePerHour: { type: "number" },
        materialsMarkupPercent: { type: "number" },
        dayworkRatePerHour: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "import_issued_boq_lines",
    description:
      "Parse issued BoQ spreadsheet(s) already uploaded on the tender Documents tab and create measured takeoff lines with budget material rates + labour. Call this when the user asks to recreate/price the bill from an uploaded Plumbing.xlsx / issued BoQ — do NOT keep asking for house types first.",
    parameters: {
      type: "object",
      properties: {
        documentNameHint: {
          type: "string",
          description: "Optional filename fragment to pick which issued BoQ (e.g. Plumbing.xlsx)",
        },
        maxLines: { type: "number", description: "Cap imported measured lines (default 400)" },
      },
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
    description: "Ask NeXa to calculate sell/cost totals for an area/house type from current lines.",
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
    description: "Validate plots for duplicates/blanks (housing jobs). On single-area projects this usually returns clean.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "generate_nexa_import",
    description: "Summarise proposed lines ready to Apply to BoQ in the UI (does not write yet).",
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

function recordDocumentIdFromUrl(url?: string) {
  const match = String(url || "").match(/\/api\/record-documents\/([^/?#]+)\/file/i);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function estimateLabourHours(quantity: number, unit: string): number {
  const qty = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const u = unit.trim().toLowerCase();
  if (u === "m" || u === "lm" || u === "run") return Math.round(qty * 0.12 * 2) / 2;
  if (u === "m2" || u === "sqm") return Math.round(qty * 0.25 * 2) / 2;
  if (u === "nr" || u === "no" || u === "each" || u === "ea") return Math.round(qty * 0.5 * 2) / 2;
  if (u === "lot" || u === "item" || u === "sum") return Math.max(1, Math.round(qty * 2 * 2) / 2);
  if (u === "set") return Math.round(qty * 1 * 2) / 2;
  return Math.round(qty * 0.35 * 2) / 2;
}

export function executeAiTakeoffTool(
  tenderId: string,
  name: string,
  args: ToolArgs,
): { ok: boolean; message: string; state: TenderAiTakeoffState } {
  let state = getTenderAiTakeoffState(tenderId);

  switch (name) {
    case "set_single_area_project": {
      const areaName = asString(args.areaName) || "Whole building";
      state = setAiTakeoffHouseTypes(tenderId, [areaName]);
      state = setAiTakeoffPlots(tenderId, [{ plot: "1", houseType: areaName }]);
      return {
        ok: true,
        message: `Single-area project set: “${areaName}” (plot 1). No housing plot register required — proceed to import_issued_boq_lines or add_takeoff_item.`,
        state,
      };
    }
    case "create_house_type": {
      const houseTypes = Array.isArray(args.houseTypes)
        ? args.houseTypes.map((row) => asString(row)).filter(Boolean)
        : [];
      if (!houseTypes.length) return { ok: false, message: "No area/house types provided.", state };
      state = setAiTakeoffHouseTypes(tenderId, [...state.houseTypes, ...houseTypes]);
      return { ok: true, message: `Areas/house types now: ${state.houseTypes.join(", ")}`, state };
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
    case "update_pricing_rules": {
      const patch: Record<string, number> = {};
      if (args.labourRatePerHour !== undefined) patch.labourRatePerHour = asNumber(args.labourRatePerHour, state.pricingRules.labourRatePerHour);
      if (args.materialsMarkupPercent !== undefined) {
        patch.materialsMarkupPercent = asNumber(args.materialsMarkupPercent, state.pricingRules.materialsMarkupPercent);
      }
      if (args.dayworkRatePerHour !== undefined) {
        patch.dayworkRatePerHour = asNumber(args.dayworkRatePerHour, state.pricingRules.dayworkRatePerHour);
      }
      state = updateAiTakeoffPricingRules(tenderId, patch);
      return {
        ok: true,
        message: `Pricing rules: labour £${state.pricingRules.labourRatePerHour}/h, materials markup ${state.pricingRules.materialsMarkupPercent}%, daywork £${state.pricingRules.dayworkRatePerHour}/h.`,
        state,
      };
    }
    case "import_issued_boq_lines": {
      const tender = getTender(tenderId);
      if (!tender) return { ok: false, message: "Tender not found.", state };
      const hint = asString(args.documentNameHint).toLowerCase();
      const candidates = (tender.documents || []).filter((doc) => {
        const kind = String(doc.kind || "");
        const name = String(doc.name || "");
        if (!/\.(xlsx|xls)$/i.test(name)) return false;
        const kindMatch = kind === "issued-boq" || kind === "priced-boq";
        const nameMatch = /boq|bill|plumbing|mechanical|heating/i.test(name);
        if (!kindMatch && !nameMatch) return false;
        if (!hint) return true;
        return name.toLowerCase().includes(hint);
      });
      if (!candidates.length) {
        return {
          ok: false,
          message:
            "No issued BoQ spreadsheet found on this tender’s Documents tab. Upload Plumbing.xlsx (or similar) under Documents → Issued BoQ, then try again.",
          state,
        };
      }

      // Prefer a single-area default so import does not stall on housing prompts.
      if (!state.houseTypes.length) {
        state = setAiTakeoffHouseTypes(tenderId, ["Whole building"]);
        state = setAiTakeoffPlots(tenderId, [{ plot: "1", houseType: "Whole building" }]);
      } else if (!state.plots.length) {
        state = setAiTakeoffPlots(tenderId, [{ plot: "1", houseType: state.houseTypes[0]! }]);
      }

      const area = state.houseTypes[0] || "Whole building";
      const maxLines = Math.min(800, Math.max(1, Math.floor(asNumber(args.maxLines, 400))));
      const notes: string[] = [];
      let importedTotal = 0;

      for (const doc of candidates.slice(0, 3)) {
        const recordId = recordDocumentIdFromUrl(doc.url);
        if (!recordId || !getRecordDocument(recordId)) {
          notes.push(`Could not read file bytes for ${doc.name}.`);
          continue;
        }
        const file = readRecordDocumentFile(recordId);
        if (!file?.bytes?.length) {
          notes.push(`Empty file for ${doc.name}.`);
          continue;
        }
        try {
          const sheets = workbookBoqSheetsFromBuffer(file.bytes);
          const parsed = parseBoqFromWorkbookSheets(sheets, doc.name);
          const measured = parsed.lines.filter((line) => line.kind === "measured");
          const imported: AiTakeoffLine[] = [];
          for (const line of measured) {
            if (imported.length >= maxLines) break;
            const qty = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 0;
            if (qty <= 0) continue;
            const unit = String(line.unit || "nr").trim() || "nr";
            const fromBill = typeof line.rate === "number" && Number.isFinite(line.rate) && line.rate > 0
              ? line.rate
              : 0;
            const unitCost = fromBill > 0 ? fromBill : softGuideUnitCost(line.description, unit);
            imported.push({
              id: makeAiTakeoffLineId(),
              revisionId: state.activeRevisionId,
              status: "proposed",
              kind: "measured",
              description: line.description,
              quantity: qty,
              unit,
              houseType: area,
              plotNumber: "1",
              costCentre: line.section || line.sheet || undefined,
              phase: "general",
              ref: line.ref || undefined,
              unitCost,
              markupPercent: state.pricingRules.materialsMarkupPercent,
              labourHours: estimateLabourHours(qty, unit),
              labourRate: state.pricingRules.labourRatePerHour,
              sourceDocument: doc.name,
              confidence: fromBill > 0 ? "High" : unitCost > 0 ? "Medium" : "Low",
              updatedAt: new Date().toISOString(),
            });
          }
          state = replaceAiTakeoffLinesFromSource(tenderId, doc.name, imported);
          importedTotal += imported.length;
          notes.push(`Parsed ${doc.name}: ${measured.length} measured row(s), kept ${imported.length}.`);
        } catch (error) {
          notes.push(`Failed to parse ${doc.name}: ${error instanceof Error ? error.message : "error"}`);
        }
      }

      if (!importedTotal) {
        return {
          ok: false,
          message: `No measured BoQ lines imported. ${notes.join(" ")}`,
          state: getTenderAiTakeoffState(tenderId),
        };
      }

      state = getTenderAiTakeoffState(tenderId);
      const { state: deduped, removed } = dedupeAiTakeoffLines(tenderId);
      state = deduped;
      const totals = calculateProjectTotals(state.lines, state.plots, state.pricingRules);
      return {
        ok: true,
        message: `Imported ${importedTotal} takeoff line(s) into area “${area}”. ${notes.join(" ")}${
          removed ? ` Removed ${removed} duplicate(s).` : ""
        } Project sell £${totals.totalSell.toFixed(2)} (ex VAT). Click Apply to BoQ when ready.`,
        state,
      };
    }
    case "add_takeoff_item": {
      const description = asString(args.description);
      if (!description) return { ok: false, message: "description is required.", state };
      const defaultArea = state.houseTypes[0];
      const line: AiTakeoffLine = {
        id: makeAiTakeoffLineId(),
        revisionId: state.activeRevisionId,
        status: "proposed",
        kind: "measured",
        description,
        quantity: asNumber(args.quantity),
        unit: asString(args.unit) || "nr",
        houseType: asString(args.houseType) || defaultArea || undefined,
        plotNumber: asString(args.plotNumber) || (defaultArea ? "1" : undefined),
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
        message: errors.length ? errors.join(" ") : "Register and lines look clean.",
        state,
      };
    }
    case "generate_nexa_import": {
      const accepted = state.lines.filter((line) => line.status === "accepted" || line.status === "proposed");
      const project = calculateProjectTotals(accepted, state.plots, state.pricingRules);
      return {
        ok: true,
        message: `Ready to import ${accepted.length} lines. Project sell £${project.totalSell.toFixed(2)} + VAT £${project.vat.toFixed(2)} = £${project.grandTotal.toFixed(2)}. Use Apply to BoQ in the UI to write.`,
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
  if (conversationId !== undefined) {
    state.openaiConversationId = conversationId.trim() || undefined;
  }
  return saveTenderAiTakeoffState(state);
}
