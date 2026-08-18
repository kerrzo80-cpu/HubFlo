import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  kitLinesToTenderBoqLines,
  mergeHeatDesignBoqLines,
  type KitLine,
} from "@/lib/heat-design";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";
import { getTender, listTendersLean, updateTender, upsertTender } from "@/lib/tenders-data";
import { computeBoqTotal } from "@/lib/tenders-types";

type PushBody = {
  /** Existing tender id, or omit / empty to create a new tender */
  tenderId?: string;
  createNew?: boolean;
  projectId?: string;
  customerName?: string;
  projectName?: string;
  address?: string;
  chosenSystemLabel?: string;
  flowTemperature?: number;
  emitterMode?: string;
  markupPercent?: number;
  kit: KitLine[];
};

function canEditTenders(access: ReturnType<typeof getAccessProfileFromHeaders>) {
  return access.canCreateQuote || access.canEditJobs || access.showFinance || access.canCustomize;
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canEditTenders(access)) {
    return NextResponse.json(
      { error: "Sign in with tender access to push heat-design materials into a tender BoQ." },
      { status: 403 },
    );
  }

  const body = await parseJsonRequestBody<PushBody>(request);
  if (!body?.kit?.length) {
    return NextResponse.json({ error: "No kit materials to push onto the tender." }, { status: 400 });
  }

  const { actor } = surveyRequestContext(request);
  const markupPercent = body.markupPercent ?? 35;
  const systemLabel = body.chosenSystemLabel || "Heating design";
  const heatLines = kitLinesToTenderBoqLines(body.kit, { markupPercent, systemLabel });
  if (!heatLines.length) {
    return NextResponse.json({ error: "No priced kit lines to push onto the tender BoQ." }, { status: 400 });
  }

  const heatSell = previousHeatDesignBoqSell(heatLines);
  const descriptionNote = [
    `Heat design materials — ${systemLabel}`,
    body.flowTemperature ? `Design flow ${body.flowTemperature}°C` : null,
    body.emitterMode ? `Emitters: ${body.emitterMode}` : null,
    body.address || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const createNew = Boolean(body.createNew) || !body.tenderId;
  let tender = body.tenderId && !createNew ? getTender(body.tenderId) : null;

  if (!tender && !createNew && body.tenderId) {
    return NextResponse.json({ error: "Selected tender was not found." }, { status: 404 });
  }

  if (!tender) {
    tender = upsertTender({
      name: body.projectName || "Heat design opportunity",
      client: body.customerName || "Heat design client",
      category: "Heating",
      area: "Aberdeen",
      status: "In Progress",
      owner: actor,
      materialsNote: descriptionNote,
      boqTitle: "Heating design",
      boqLines: heatLines,
      bidValue: heatSell,
      tenderSum: heatSell,
    });
  } else {
    const boqLines = mergeHeatDesignBoqLines(tender.boqLines, heatLines);
    const boqTotal = computeBoqTotal(boqLines);
    const nextMaterialsNote = tender.materialsNote?.includes("Heat design")
      ? tender.materialsNote
      : [tender.materialsNote, descriptionNote].filter(Boolean).join("\n").trim();
    tender = updateTender(tender.id, {
      boqLines,
      boqTitle: tender.boqTitle || "Heating design",
      materialsNote: nextMaterialsNote,
      status: tender.status === "Not Started" ? "In Progress" : tender.status,
      tenderSum: boqTotal,
      bidValue: boqTotal,
    });
  }

  const measuredCount = heatLines.filter((line) => line.kind === "measured").length;
  appendAuditEvent({
    actor,
    action: createNew ? "created" : "updated",
    recordType: "tender",
    recordId: tender.id,
    summary: `Heat design ${createNew ? "created" : "updated"} tender ${tender.name} with ${measuredCount} BoQ line(s) (${systemLabel}).`,
    source: "Heat Design",
    importance: "normal",
  });

  return NextResponse.json({
    tender: {
      id: tender.id,
      name: tender.name,
      client: tender.client,
      status: tender.status,
      bidValue: tender.bidValue,
      tenderSum: tender.tenderSum,
    },
    created: createNew,
    lineCount: measuredCount,
    sellTotal: heatSell,
    tendersAvailable: listTendersLean().length,
    note: "Open Core → Tenders → this opportunity → BoQ sheet “Heating design” to review lines.",
  });
}
