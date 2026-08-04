import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  kitLinesToQuoteCostLines,
  kitSellTotal,
  previousQuoteLinesSell,
  type KitLine,
} from "@/lib/heat-design";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";
import { createQuote, getQuotes, updateQuote } from "@/lib/workflow-data";

type PushBody = {
  /** Existing quote id, or omit / empty to create a new quote */
  quoteId?: string;
  createNew?: boolean;
  customerName?: string;
  projectName?: string;
  address?: string;
  chosenSystemLabel?: string;
  flowTemperature?: number;
  emitterMode?: string;
  markupPercent?: number;
  kit: KitLine[];
};

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json(
      { error: "Sign in with quote access to push heat-design materials into a quote." },
      { status: 403 },
    );
  }

  const body = await parseJsonRequestBody<PushBody>(request);
  if (!body?.kit?.length) {
    return NextResponse.json({ error: "No kit materials to push." }, { status: 400 });
  }

  const { actor } = surveyRequestContext(request);
  const markupPercent = body.markupPercent ?? 35;
  const lines = kitLinesToQuoteCostLines(body.kit, markupPercent);
  const sellTotal = kitSellTotal(lines);
  const systemLabel = body.chosenSystemLabel || "Heating design";
  const description = [
    `Heat design materials — ${systemLabel}`,
    body.flowTemperature ? `Design flow ${body.flowTemperature}°C` : null,
    body.emitterMode ? `Emitters: ${body.emitterMode}` : null,
    body.address || null,
  ]
    .filter(Boolean)
    .join("\n");

  const createNew = Boolean(body.createNew) || !body.quoteId;
  let quote = body.quoteId && !createNew ? getQuotes().find((row) => row.id === body.quoteId) : undefined;

  if (!quote && !createNew && body.quoteId) {
    return NextResponse.json({ error: "Selected quote was not found." }, { status: 404 });
  }

  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const centreId = quote ? `heat-design-centre-${quote.id}` : "";
  const hubStatePreview = getHubDetailState();
  const prevCentresPreview = quote
    ? ((hubStatePreview.quoteCostCentres ?? {}) as Record<string, Array<{ id: string; lines?: unknown[] }>>)[
        quote.id
      ] ?? []
    : [];
  const prevCentrePreview = prevCentresPreview.find((centre) => centre.id === centreId);
  const previousSell = previousQuoteLinesSell(
    prevCentrePreview?.lines as Array<{ quantity?: number; unitSell?: number; unitCost?: number }> | undefined,
  );

  if (!quote) {
    quote = createQuote({
      ref: "",
      customer: body.customerName || "Heat design customer",
      description,
      owner: actor,
      status: "Draft",
      value: sellTotal,
      next: "Review heat-design materials cost centre and send quote",
      due,
    });
  } else {
    const nextValue = Math.max(0, Math.round((quote.value - previousSell + sellTotal) * 100) / 100);
    quote = updateQuote(quote.id, {
      customer: body.customerName || quote.customer,
      description: quote.description?.includes("Heat design")
        ? quote.description
        : `${quote.description}\n\n${description}`.trim(),
      owner: actor,
      value: nextValue,
      next: "Review heat-design materials cost centre and send quote",
    })!;
  }

  const sectionId = `heat-design-section-${quote.id}`;
  const resolvedCentreId = `heat-design-centre-${quote.id}`;
  const hubState = getHubDetailState();
  const currentSections = (hubState.quoteSections ?? {}) as Record<
    string,
    Array<{ id: string; name: string; description: string }>
  >;
  const currentCentres = (hubState.quoteCostCentres ?? {}) as Record<
    string,
    Array<{
      id: string;
      name: string;
      sectionId: string;
      templateName?: string;
      clientDescription?: string;
      engineerDescription?: string;
      lines: unknown[];
      heatLossRooms?: unknown[];
    }>
  >;

  const prevCentres = currentCentres[quote.id] ?? [];
  const withoutOld = prevCentres.filter((centre) => centre.id !== resolvedCentreId);
  const nextCentre = {
    id: resolvedCentreId,
    name: "Heating design",
    sectionId,
    templateName: "Heating design",
    clientDescription: description,
    engineerDescription: `${systemLabel} kit from Heat Design (/heat-design) — converts to job materials with the quote.`,
    lines,
    heatLossRooms: [
      {
        id: "hd-flow",
        name: "Design basis",
        meanWaterTemperature: String(body.flowTemperature ?? ""),
        heatingSystemType: systemLabel,
      },
    ],
  };

  saveHubDetailState({
    ...hubState,
    quoteSections: {
      ...currentSections,
      [quote.id]: [
        ...(currentSections[quote.id] ?? []).filter((section) => section.id !== sectionId),
        { id: sectionId, name: body.projectName || "Heat design", description: systemLabel },
      ],
    },
    quoteCostCentres: {
      ...currentCentres,
      [quote.id]: [...withoutOld, nextCentre],
    },
  });

  appendAuditEvent({
    actor,
    action: createNew ? "created" : "updated",
    recordType: "quote",
    recordId: quote.id,
    summary: `Heat design ${createNew ? "created" : "updated"} ${quote.ref} with ${lines.length} material line(s) (${systemLabel}).`,
    source: "Heat Design",
    importance: "normal",
  });

  return NextResponse.json({
    quote: {
      id: quote.id,
      ref: quote.ref,
      customer: quote.customer,
      status: quote.status,
      value: quote.value,
    },
    created: createNew,
    costCentre: nextCentre,
    lineCount: lines.length,
    sellTotal,
    quotesAvailable: getQuotes().length,
    note: "Open Core → Quotes → this quote → Heating design cost centre. Materials carry across when converted to a job.",
  });
}
