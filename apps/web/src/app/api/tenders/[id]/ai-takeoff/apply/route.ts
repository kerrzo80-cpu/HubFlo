import { NextRequest, NextResponse } from "next/server";

import { calculateTakeoffLine } from "@/lib/ai-takeoff-calc";
import { getTenderAiTakeoffState, saveTenderAiTakeoffState } from "@/lib/ai-takeoff-store";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getTender, importBoqLinesIntoTender } from "@/lib/tenders-data";
import type { TenderBoqLine } from "@/lib/tenders-types";

type Params = { params: Promise<{ id: string }> };

/**
 * Apply accepted/proposed AI takeoff lines into the tender BoQ as a new sheet.
 * Money is recalculated by NeXa before write.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const tender = getTender(id);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const body = await parseJsonRequestBody<{ onlyAccepted?: boolean; sheetName?: string }>(request);
  const state = getTenderAiTakeoffState(id);
  const onlyAccepted = Boolean(body?.onlyAccepted);
  const sourceLines = state.lines.filter((line) =>
    onlyAccepted ? line.status === "accepted" : line.status === "accepted" || line.status === "proposed",
  );
  if (!sourceLines.length) {
    return NextResponse.json({ error: "No proposed/accepted AI takeoff lines to apply." }, { status: 422 });
  }

  const sheetName = body?.sheetName?.trim() || `Blake Takeoff · ${new Date().toISOString().slice(0, 10)}`;
  const unpricedMeasured = sourceLines.filter((line) => {
    if (line.kind === "header" || line.kind === "note") return false;
    const calc = calculateTakeoffLine(line, state.pricingRules);
    return calc.lineTotalSell <= 0 && calc.labourHours <= 0;
  });
  if (unpricedMeasured.length) {
    return NextResponse.json(
      {
        error: `${unpricedMeasured.length} measured line(s) have no unit cost or labour — price them (or mark as notes) before Apply to BoQ.`,
        unpriced: unpricedMeasured.map((line) => line.id),
      },
      { status: 422 },
    );
  }

  const boqLines: TenderBoqLine[] = sourceLines.map((line, index) => {
    const calc = calculateTakeoffLine(line, state.pricingRules);
    const kind: TenderBoqLine["kind"] =
      line.kind === "header" || line.kind === "note" ? line.kind : "measured";
    // All-in sell rate so rate × qty === value (materials + labour), not materials-only.
    const sellRate =
      kind === "measured" && calc.quantity > 0
        ? Math.round((calc.lineTotalSell / calc.quantity) * 100) / 100
        : 0;
    const areaLabel = line.houseType
      ? state.plots.length <= 1
        ? `Area: ${line.houseType}`
        : `House: ${line.houseType}`
      : null;
    return {
      id: `ai-takeoff-${line.id}`,
      kind,
      ref: line.ref || `AI-${index + 1}`,
      description: [
        line.description,
        areaLabel,
        line.plotNumber && state.plots.length > 1 ? `Plot: ${line.plotNumber}` : null,
        line.phase && line.phase !== "general" ? line.phase : null,
      ]
        .filter(Boolean)
        .join(" · "),
      quantity: kind === "measured" ? calc.quantity : null,
      unit: kind === "measured" ? calc.unit : undefined,
      rate: kind === "measured" ? sellRate : null,
      value: kind === "measured" ? calc.lineTotalSell : null,
      sheet: sheetName,
      section: line.costCentre || "Blake Takeoff",
      pricingSource: "blake-budget" as const,
    };
  });

  let updated;
  try {
    updated = importBoqLinesIntoTender(id, boqLines, sheetName, {
      mode: "append",
      appendSheetLabel: sheetName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import AI lines into tender BoQ.";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const appliedAt = new Date().toISOString();
  state.lines = state.lines.map((line) => {
    if (!sourceLines.some((row) => row.id === line.id)) return line;
    return {
      ...line,
      status: "applied" as const,
      appliedBoqLineId: `ai-takeoff-${line.id}`,
      updatedAt: appliedAt,
    };
  });
  saveTenderAiTakeoffState(state);

  return NextResponse.json({
    ok: true,
    applied: sourceLines.length,
    sheetName,
    tender: updated,
    state: getTenderAiTakeoffState(id),
  });
}
