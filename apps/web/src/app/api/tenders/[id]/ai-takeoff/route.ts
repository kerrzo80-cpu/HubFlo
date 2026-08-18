import { NextRequest, NextResponse } from "next/server";

import { AI_TAKEOFF_TOOL_DEFINITIONS, executeAiTakeoffTool, patchAiTakeoffLinkedProject } from "@/lib/ai-takeoff-tools";
import {
  appendAiTakeoffMessage,
  attachAiTakeoffFile,
  getTenderAiTakeoffState,
  updateAiTakeoffPricingRules,
} from "@/lib/ai-takeoff-store";
import { calculateProjectTotals, findDuplicateTakeoffLines, validatePlotRegister } from "@/lib/ai-takeoff-calc";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import { getTender } from "@/lib/tenders-data";

type Params = { params: Promise<{ id: string }> };

type ChatBody = {
  message?: string;
  action?: "chat" | "sync-files" | "update-rules" | "recalculate";
  pricingRules?: Record<string, unknown>;
};

const SYSTEM_PROMPT = `You are Blake — NeXa’s plumbing & heating takeoff estimator inside Tenders.
Speak as Blake (never call yourself “AI Takeoff Assistant”). Be direct, practical, and UK trade-aware.

Project types:
- Housing estates: house types + plot registers are useful.
- Commercial / refurb / health club / plant / school / single building: do NOT demand house types or plot schedules. Call set_single_area_project with a sensible area name (e.g. “Health Club”) and move on.
- If the user says there are no house types / plots / it is not a house — believe them immediately. Never loop asking for house types.

When issued BoQ / Plumbing.xlsx is already on the tender Documents tab (see tender snapshot):
1) update_pricing_rules if the user gave labour £/h or markup %
2) set_single_area_project when it is not a multi-plot housing job
3) import_issued_boq_lines (use documentNameHint if they named a file)
4) generate_nexa_import and tell them to click Apply to BoQ

Do not ask the user how to upload if Documents already lists the file — import it.
Do not paste fake money totals — NeXa calculates via tools. Prefer tools over long Q&A.

Rules (editable in NeXa; defaults already applied):
- Labour £70/h, daywork £60/h, materials markup 30%, sanitaryware 20% where applicable
- Round labour to nearest 0.5h
- Sprinklers by others unless specifically included
- Never hide provisional quantities
- Pipework in metres; fittings as nr / lot / set
- Split 1st fix, 2nd fix, commissioning, return visits when the bill supports it
- On housing jobs only: plots must reconcile to house types
- Never silently override a confirmed user correction — highlight conflicts`;

export async function GET(request: NextRequest, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote && !access.showQuotes) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const tender = getTender(id);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const state = getTenderAiTakeoffState(id);
  // Sync document list from tender without requiring chat
  for (const doc of tender.documents || []) {
    attachAiTakeoffFile(id, {
      tenderDocumentId: doc.id,
      name: doc.name || "Document",
      kind: doc.kind || "other",
      url: doc.url,
    });
  }
  const refreshed = getTenderAiTakeoffState(id);
  if (tender.linkedTakeoffId && refreshed.linkedTakeoffId !== tender.linkedTakeoffId) {
    patchAiTakeoffLinkedProject(id, tender.linkedTakeoffId);
  }

  const totals = calculateProjectTotals(refreshed.lines, refreshed.plots, refreshed.pricingRules);
  const validation = [
    ...validatePlotRegister(refreshed.plots, refreshed.houseTypes),
    ...findDuplicateTakeoffLines(refreshed.lines),
  ];
  const ai = getTakeoffOpenAiConfig();

  return NextResponse.json({
    state: getTenderAiTakeoffState(id),
    totals,
    validation,
    ai: { connected: ai.connected, model: ai.model, keyName: ai.keyName },
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden — needs quote create permission." }, { status: 403 });
  }
  const { id } = await params;
  const tender = getTender(id);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const body = await parseJsonRequestBody<ChatBody>(request);
  const action = body?.action || "chat";

  if (action === "sync-files") {
    for (const doc of tender.documents || []) {
      attachAiTakeoffFile(id, {
        tenderDocumentId: doc.id,
        name: doc.name || "Document",
        kind: doc.kind || "other",
        url: doc.url,
      });
    }
    return NextResponse.json({ state: getTenderAiTakeoffState(id) });
  }

  if (action === "update-rules" && body?.pricingRules) {
    const state = updateAiTakeoffPricingRules(id, body.pricingRules as never);
    return NextResponse.json({ state });
  }

  if (action === "recalculate") {
    const state = getTenderAiTakeoffState(id);
    const totals = calculateProjectTotals(state.lines, state.plots, state.pricingRules);
    const validation = [
      ...validatePlotRegister(state.plots, state.houseTypes),
      ...findDuplicateTakeoffLines(state.lines),
    ];
    return NextResponse.json({ state, totals, validation });
  }

  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  appendAiTakeoffMessage(id, { role: "user", text: message });
  const state = getTenderAiTakeoffState(id);
  const ai = getTakeoffOpenAiConfig();

  if (!ai.connected) {
    const reply = "Blake / OpenAI is not connected. Set NEXA_OPENAI_API_KEY on Render or add a key in Setup → Integrations → NeXa AI. You can still set a single area, import an issued BoQ, and add lines manually in this workspace.";
    appendAiTakeoffMessage(id, { role: "assistant", text: reply });
    return NextResponse.json({
      state: getTenderAiTakeoffState(id),
      totals: calculateProjectTotals(state.lines, state.plots, state.pricingRules),
      ai: { connected: false, model: ai.model, keyName: ai.keyName },
    });
  }

  const docSummary = (tender.documents || [])
    .slice(0, 40)
    .map((doc) => `- ${doc.kind}: ${doc.name}`)
    .join("\n");

  const snapshot = {
    tender: { id: tender.id, name: tender.name, client: tender.client, status: tender.status },
    pricingRules: state.pricingRules,
    houseTypes: state.houseTypes,
    plotCount: state.plots.length,
    lineCount: state.lines.length,
    openAssumptions: state.assumptions.filter((row) => row.status === "open").map((row) => row.text),
    documents: docSummary,
    hint:
      "If Documents lists an issued BoQ (.xlsx), call import_issued_boq_lines. If this is not multi-plot housing, call set_single_area_project first — do not keep asking for house types.",
  };

  try {
    const input = [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: `Tender snapshot JSON:\n${JSON.stringify(snapshot)}\n\nUser message:\n${message}`,
        }],
      },
    ];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ai.model,
        input,
        tools: AI_TAKEOFF_TOOL_DEFINITIONS,
        store: true,
        ...(state.openaiConversationId ? { conversation: state.openaiConversationId } : {}),
      }),
    });

    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const errText = typeof payload?.error === "object" && payload.error && "message" in (payload.error as object)
        ? String((payload.error as { message?: string }).message)
        : `OpenAI error ${response.status}`;
      appendAiTakeoffMessage(id, { role: "assistant", text: `Could not reach OpenAI: ${errText}` });
      return NextResponse.json({ state: getTenderAiTakeoffState(id), error: errText }, { status: 502 });
    }

    const responseId = typeof payload?.id === "string" ? payload.id : undefined;
    const conversationId = typeof payload?.conversation === "string"
      ? payload.conversation
      : typeof (payload?.conversation as { id?: string } | undefined)?.id === "string"
        ? (payload?.conversation as { id: string }).id
        : undefined;
    if (conversationId) patchAiTakeoffLinkedProject(id, undefined, conversationId);

    const toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: string }> = [];
    const output = Array.isArray(payload?.output) ? payload.output : [];
    let assistantText = "";

    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (row.type === "message" && Array.isArray(row.content)) {
        for (const part of row.content) {
          if (part && typeof part === "object" && (part as { type?: string }).type === "output_text") {
            assistantText += String((part as { text?: string }).text || "");
          }
        }
      }
      if (row.type === "function_call") {
        const name = String(row.name || "");
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(row.arguments || "{}")) as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = executeAiTakeoffTool(id, name, args);
        toolCalls.push({ name, args, result: result.message });
      }
    }

    if (!assistantText && toolCalls.length) {
      assistantText = toolCalls.map((call) => `${call.name}: ${call.result}`).join("\n");
    }
    if (!assistantText) assistantText = "Done — review the live takeoff table and assumptions panel.";

    appendAiTakeoffMessage(id, {
      role: "assistant",
      text: assistantText,
      toolCalls,
      openaiResponseId: responseId,
    });

    const next = getTenderAiTakeoffState(id);
    return NextResponse.json({
      state: next,
      totals: calculateProjectTotals(next.lines, next.plots, next.pricingRules),
      validation: [
        ...validatePlotRegister(next.plots, next.houseTypes),
        ...findDuplicateTakeoffLines(next.lines),
      ],
      ai: { connected: true, model: ai.model, keyName: ai.keyName },
    });
  } catch (error) {
    const errText = error instanceof Error ? error.message : "AI takeoff failed";
    appendAiTakeoffMessage(id, { role: "assistant", text: errText });
    return NextResponse.json({ error: errText, state: getTenderAiTakeoffState(id) }, { status: 500 });
  }
}
