import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { kitLinesToQuoteCostLines, kitSellTotal, type KitLine } from "@/lib/heat-design";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";
import { createQuote, getQuotes, updateQuote } from "@/lib/workflow-data";

type PushBody = {
  quoteId?: string;
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

  const existing = body.quoteId ? getQuotes().find((quote) => quote.id === body.quoteId) : undefined;
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const quote = existing
    ? updateQuote(existing.id, {
        customer: body.customerName || existing.customer,
        description: existing.description ? `${existing.description}\n\n${description}` : description,
        owner: actor,
        value: Math.round((existing.value + sellTotal) * 100) / 100,
        next: "Review heat-design materials cost centre and send quote",
      })!
    : createQuote({
        ref: "",
        customer: body.customerName || "Heat design customer",
        description,
        owner: actor,
        status: "Draft",
        value: sellTotal,
        next: "Review heat-design materials cost centre and send quote",
        due,
      });

  const sectionId = `heat-design-section-${quote.id}`;
  const centreId = `heat-design-centre-${quote.id}`;
  const hubState = getHubDetailState();
  const currentSections = (hubState.quoteSections ?? {}) as Record<string, Array<{ id: string; name: string; description: string }>>;
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
  const withoutOld = prevCentres.filter((centre) => centre.id !== centreId);
  const nextCentre = {
    id: centreId,
    name: "Heating design",
    sectionId,
    templateName: "Heating design",
    clientDescription: description,
    engineerDescription: `${systemLabel} kit from /heat-design — converts to job materials with the quote.`,
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
    action: "pushed",
    recordType: "quote",
    recordId: quote.id,
    summary: `Heat design pushed ${lines.length} material line(s) into ${quote.ref} (${systemLabel}).`,
    source: "Heat Design",
    importance: "normal",
  });

  return NextResponse.json({
    quote,
    costCentre: nextCentre,
    lineCount: lines.length,
    sellTotal,
    note: "When this quote converts to a job, these materials carry across into the job cost centres.",
  });
}
