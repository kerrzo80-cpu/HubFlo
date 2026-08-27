import { assertMaterialsPricedForPush } from "@/lib/commercial-safeguards";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { appendAuditEvent } from "@/lib/people-data";
import {
  getEstimate,
  getSurvey,
  recordEstimateQuotePush,
} from "@/lib/survey-estimator-store";
import { createQuote, getQuotes, updateQuote } from "@/lib/workflow-data";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "works";
}

function friendlyFallbackArea(jobType: string) {
  if (/bath|wet room|shower/i.test(jobType)) return "Bathroom";
  if (/kitchen/i.test(jobType)) return "Kitchen";
  if (/boiler|heating|radiator|ashp|underfloor/i.test(jobType)) return "Heating";
  return "Works";
}

function cleanArea(value: unknown, fallback: string) {
  const text = String(value || "").trim();
  if (!text || /^(tbc|unknown|n\/a|none)$/i.test(text)) return fallback;
  return text;
}

function bulletScope(taskType: string, notes: string, quantity: number) {
  const task = taskType.trim();
  const detail = notes.trim();
  const qty = quantity > 1 ? `${quantity} × ` : "";
  if (!detail) return `• ${qty}${task}`;
  if (detail.toLowerCase().startsWith(task.toLowerCase())) return `• ${qty}${detail}`;
  return `• ${qty}${task} — ${detail}`;
}

export type AylaRoomQuoteResult = {
  quote: ReturnType<typeof createQuote>;
  costCentres: Array<Record<string, unknown>>;
  rooms: string[];
  totalSell: number;
  materialCost: number;
  labourCost: number;
};

/**
 * Convert an Estimator result into the simple domestic quote shape Ayla uses:
 * one client-facing cost centre per room / logical work area, with the detailed
 * materials and labour retained as hidden internal build-up lines.
 */
export function buildAylaRoomQuoteFromEstimate(input: {
  tenantId: string;
  estimateId: string;
  actor: string;
  expectedVersion?: number;
}): AylaRoomQuoteResult {
  const estimate = getEstimate(input.tenantId, input.estimateId);
  if (!estimate) throw new Error("Estimate not found.");
  const survey = getSurvey(input.tenantId, estimate.surveyId);
  if (!survey) throw new Error("Source survey not found.");

  const priceGate = assertMaterialsPricedForPush(
    estimate.materialLines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      status: line.status,
      supplierRequired: line.status === "Supplier RFQ",
    })),
  );
  if (priceGate) throw new Error(priceGate);

  const fallbackArea = friendlyFallbackArea(survey.jobType);
  const scopeById = new Map(survey.scopeItems.map((item) => [item.id, item]));
  const equipmentById = new Map(survey.equipmentItems.map((item) => [item.id, item]));
  const runById = new Map(survey.pipeRuns.map((item) => [item.id, item]));

  const knownAreas = Array.from(new Set([
    ...survey.scopeItems.map((item) => cleanArea(item.roomOrArea, fallbackArea)),
    ...survey.rooms.map((room) => cleanArea(room.name, fallbackArea)),
  ].filter(Boolean)));
  const singleArea = knownAreas.length === 1 ? knownAreas[0]! : undefined;

  const areaForSource = (sourceId: string | undefined) => {
    if (sourceId) {
      const scope = scopeById.get(sourceId);
      if (scope) return cleanArea(scope.roomOrArea, fallbackArea);
      const equipment = equipmentById.get(sourceId);
      if (equipment) return cleanArea(equipment.roomOrArea, fallbackArea);
      const run = runById.get(sourceId);
      if (run) {
        const from = cleanArea(run.fromLocation, "");
        const to = cleanArea(run.toLocation, "");
        if (from && to && from.toLowerCase() === to.toLowerCase()) return from;
      }
    }
    return singleArea || fallbackArea;
  };

  const materialSell = (line: (typeof estimate.materialLines)[number]) =>
    (line.unitCost || 0) * (1 + line.markupPercent / 100);

  const materialCost = estimate.materialLines.reduce((sum, line) => sum + (line.unitCost || 0) * line.quantity, 0);
  const labourCost = estimate.labourLines.reduce((sum, line) => sum + line.costRate * line.hours, 0);
  const totalSell = estimate.materialLines.reduce((sum, line) => sum + materialSell(line) * line.quantity, 0)
    + estimate.labourLines.reduce((sum, line) => sum + line.sellRate * line.hours, 0);

  const groups = new Map<string, {
    materials: typeof estimate.materialLines;
    labour: typeof estimate.labourLines;
  }>();
  const ensureGroup = (area: string) => {
    const name = cleanArea(area, fallbackArea);
    const current = groups.get(name);
    if (current) return current;
    const next = { materials: [] as typeof estimate.materialLines, labour: [] as typeof estimate.labourLines };
    groups.set(name, next);
    return next;
  };

  for (const line of estimate.materialLines) ensureGroup(areaForSource(line.sourceId)).materials.push(line);
  for (const line of estimate.labourLines) ensureGroup(areaForSource(line.sourceId)).labour.push(line);
  for (const area of knownAreas) ensureGroup(area);
  if (!groups.size) ensureGroup(fallbackArea);

  const due = survey.requiredByDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const linkedQuote = survey.jobLink?.type === "Quote"
    ? getQuotes().find((quote) => quote.id === survey.jobLink?.id || quote.ref === survey.jobLink?.reference)
    : undefined;
  const overallDescription = survey.scopeItems.map((item) => bulletScope(item.taskType, item.notes, item.quantity)).join("\n")
    || survey.customerRequirements
    || survey.jobType;
  const quote = linkedQuote
    ? updateQuote(linkedQuote.id, {
        customer: survey.customerName,
        description: overallDescription,
        owner: input.actor,
        value: Math.round(totalSell * 100) / 100,
        next: "Review Ayla room cost centres and send quote",
        due,
      })!
    : createQuote({
        ref: "",
        clientId: survey.customerId,
        siteId: survey.siteId,
        customer: survey.customerName,
        description: overallDescription,
        owner: input.actor,
        status: "Draft",
        value: Math.round(totalSell * 100) / 100,
        next: "Review Ayla room cost centres and send quote",
        due,
      });

  const sectionId = `ayla-room-section-${estimate.id}`;
  const costCentres = Array.from(groups.entries()).map(([area, lines]) => {
    const areaScope = survey.scopeItems.filter((item) => cleanArea(item.roomOrArea, fallbackArea).toLowerCase() === area.toLowerCase());
    const description = areaScope.length
      ? areaScope.map((item) => bulletScope(item.taskType, item.notes, item.quantity)).join("\n")
      : `• ${survey.customerRequirements || survey.jobType}`;
    return {
      id: `ayla-room-${estimate.id}-${slug(area)}`,
      name: area,
      sectionId,
      templateName: area,
      clientDescription: description,
      engineerDescription: `Internal Blake build-up for ${area}. Client quote shows the scope and rolled-up sell total only.`,
      lines: [
        ...lines.materials.map((line) => {
          const isRfq = line.status === "Supplier RFQ" || line.unitCost === undefined;
          const pricingState = line.pricingState
            || (isRfq ? "rfq" as const : line.unitCost && line.unitCost > 0 ? "firm" as const : "rfq" as const);
          return {
            id: line.id,
            catalogItemId: "",
            description: line.description,
            quantity: line.quantity,
            unitCost: line.unitCost || 0,
            unitSell: materialSell(line),
            supplierRequired: isRfq || pricingState !== "firm",
            rateSource: "manual" as const,
            pricingState,
            pricingSource: line.pricingSource || (pricingState === "firm" ? "manual" : "supplier"),
            pricingNote: line.pricingNote,
            pricedAt: line.pricedAt || (pricingState === "firm" ? new Date().toISOString() : undefined),
            internalOnly: true,
            lineType: "material" as const,
          };
        }),
        ...lines.labour.map((line) => ({
          id: line.id,
          catalogItemId: "",
          description: `${line.labourType}: ${line.description}`,
          quantity: line.hours,
          unitCost: line.costRate,
          unitSell: line.sellRate,
          supplierRequired: false,
          rateSource: "manual" as const,
          internalOnly: true,
          lineType: "labour" as const,
        })),
      ],
    };
  });

  const hubState = getHubDetailState();
  saveHubDetailState({
    ...hubState,
    quoteSections: {
      ...(hubState.quoteSections || {}),
      [quote.id]: [{ id: sectionId, name: "Works", description: "" }],
    },
    quoteCostCentres: {
      ...(hubState.quoteCostCentres || {}),
      [quote.id]: costCentres,
    },
  });

  const recorded = recordEstimateQuotePush(input.tenantId, estimate.id, input.expectedVersion, { id: quote.id, ref: quote.ref });
  if (!recorded.ok) throw new Error(recorded.message);

  appendAuditEvent({
    actor: input.actor,
    action: "pushed",
    recordType: "quote",
    recordId: quote.id,
    summary: `${estimate.reference} created ${costCentres.length} room/work-area cost centre(s) in ${quote.ref}. Internal labour/material build-up is retained in Blake and excluded from the client scope display.`,
    source: "Ask Ayla",
    importance: "normal",
  });

  return {
    quote,
    costCentres,
    rooms: costCentres.map((item) => String(item.name)),
    totalSell: Math.round(totalSell * 100) / 100,
    materialCost: Math.round(materialCost * 100) / 100,
    labourCost: Math.round(labourCost * 100) / 100,
  };
}
