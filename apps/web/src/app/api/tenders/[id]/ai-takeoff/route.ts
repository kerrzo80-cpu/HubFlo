import { NextRequest, NextResponse } from "next/server";

import { AI_TAKEOFF_TOOL_DEFINITIONS, executeAiTakeoffTool, patchAiTakeoffLinkedProject } from "@/lib/ai-takeoff-tools";
import {
  appendAiTakeoffMessage,
  attachAiTakeoffFile,
  dedupeAiTakeoffLines,
  getTenderAiTakeoffState,
  updateAiTakeoffPricingRules,
} from "@/lib/ai-takeoff-store";
import { calculateProjectTotals, findDuplicateTakeoffLines, validatePlotRegister } from "@/lib/ai-takeoff-calc";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import { getTenderLean } from "@/lib/tenders-data";
import { openAiFetch } from "@/lib/openai-fetch";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

type ChatBody = {
  message?: string;
  action?: "chat" | "sync-files" | "update-rules" | "recalculate" | "dedupe-lines";
  pricingRules?: Record<string, unknown>;
};

const SYSTEM_PROMPT = `You are Blake — a sharp UK plumbing & heating estimator inside NeXa Tenders.
Talk like an experienced QS/estimator: clear, specific, and honest. Never sound like a scripted assistant reading policy.

How you think:
- Read the user's last message and answer THAT. Prefer short, concrete replies over procedure dumps.
- Use tools to change data; then explain what actually changed (counts, £, what is still blank).
- When the user asks to price materials / budget prices / “price this properly”, call price_takeoff_materials (with Blake budget) after lines exist. Prefer office materials catalogue matches as confirmed costs; then library; then Blake budgets for gaps.
- If Cost shows £0, materials are NOT priced — say so. Do not claim “materials are applied automatically”.
- Mention when a line was priced from the office catalogue (confirmed) vs Blake budget (provisional).
- When they say delete all / start again / clear the list, call clear_takeoff_lines (includeApplied true), then re-import if needed. Do not pretend the table is empty if it still has rows.
- Commercial / health club / single building: set_single_area_project — never nag for housing plots.
- Issued BoQ already on Documents: import_issued_boq_lines (then price_takeoff_materials when they want materials).
- Labour defaults £70/h, materials markup 30%, daywork £60/h unless the user overrides via update_pricing_rules.
- Round labour to 0.5h. Never invent fake project totals — rely on tool results.
- Be useful like ChatGPT: reason about the bill, suggest sensible UK merchant budgets, call out risks — without hiding behind “click Apply” as the only answer.`;

export async function GET(request: NextRequest, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote && !access.showQuotes) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const tender = getTenderLean(id);
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
  // Quietly collapse duplicate imports from earlier tool loops / re-runs.
  dedupeAiTakeoffLines(id);
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
  const tender = getTenderLean(id);
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

  if (action === "dedupe-lines") {
    const { state, removed } = dedupeAiTakeoffLines(id);
    const totals = calculateProjectTotals(state.lines, state.plots, state.pricingRules);
    const validation = [
      ...validatePlotRegister(state.plots, state.houseTypes),
      ...findDuplicateTakeoffLines(state.lines),
    ];
    return NextResponse.json({ state, totals, validation, removed });
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

  const recentChat = state.messages
    .slice(-8)
    .map((row) => `${row.role === "assistant" ? "Blake" : row.role}: ${row.text}`)
    .join("\n");

  const snapshot = {
    tender: { id: tender.id, name: tender.name, client: tender.client, status: tender.status },
    pricingRules: state.pricingRules,
    houseTypes: state.houseTypes,
    plotCount: state.plots.length,
    lineCount: state.lines.length,
    materialsZeroCost: state.lines.filter(
      (line) => line.kind !== "header" && line.kind !== "note" && !(line.unitCost > 0),
    ).length,
    openAssumptions: state.assumptions.filter((row) => row.status === "open").map((row) => row.text),
    documents: docSummary,
    hint:
      "If Documents lists an issued BoQ (.xlsx), import_issued_boq_lines. For materials budgets call price_takeoff_materials. If Cost is £0 / materialsZeroCost > 0, materials are not priced yet. clear_takeoff_lines when they want a clean start. Single-area commercial: set_single_area_project — no housing plots.",
  };

  try {
    type ToolCallRow = { name: string; args: Record<string, unknown>; result?: string; callId?: string };
    const toolCalls: ToolCallRow[] = [];
    let assistantText = "";
    let responseId: string | undefined;
    let conversationId = state.openaiConversationId;

    const initialInput: unknown[] = [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: [
            `Tender snapshot JSON:\n${JSON.stringify(snapshot)}`,
            recentChat ? `\nRecent chat:\n${recentChat}` : "",
            `\nUser message:\n${message}`,
          ].join(""),
        }],
      },
    ];

    let nextInput: unknown[] = initialInput;
    let previousResponseId: string | undefined;

    for (let round = 0; round < 6; round += 1) {
      const response = await openAiFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ai.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          model: ai.model,
          input: nextInput,
          tools: AI_TAKEOFF_TOOL_DEFINITIONS,
          store: true,
          ...(previousResponseId
            ? { previous_response_id: previousResponseId }
            : conversationId
              ? { conversation: conversationId }
              : {}),
        }),
      });

      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        const errText = typeof payload?.error === "object" && payload.error && "message" in (payload.error as object)
          ? String((payload.error as { message?: string }).message)
          : `OpenAI error ${response.status}`;
        // Soft-fallback: if conversation id is stale, retry once without it on first round.
        if (round === 0 && conversationId && /conversation|not found|invalid/i.test(errText)) {
          conversationId = undefined;
          patchAiTakeoffLinkedProject(id, undefined, "");
          continue;
        }
        appendAiTakeoffMessage(id, { role: "assistant", text: `Could not reach OpenAI: ${errText}` });
        return NextResponse.json({ state: getTenderAiTakeoffState(id), error: errText }, { status: 502 });
      }

      responseId = typeof payload?.id === "string" ? payload.id : responseId;
      previousResponseId = responseId;
      const nextConversationId = typeof payload?.conversation === "string"
        ? payload.conversation
        : typeof (payload?.conversation as { id?: string } | undefined)?.id === "string"
          ? (payload?.conversation as { id: string }).id
          : undefined;
      if (nextConversationId) {
        conversationId = nextConversationId;
        patchAiTakeoffLinkedProject(id, undefined, conversationId);
      }

      const output = Array.isArray(payload?.output) ? payload.output : [];
      const roundToolOutputs: Array<{ type: string; call_id: string; output: string }> = [];
      let roundHadTools = false;
      assistantText = "";

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
          roundHadTools = true;
          const name = String(row.name || "");
          const callId = String(row.call_id || row.id || "");
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(String(row.arguments || "{}")) as Record<string, unknown>;
          } catch {
            args = {};
          }
          const result = await executeAiTakeoffTool(id, name, args);
          toolCalls.push({ name, args, result: result.message, callId });
          if (callId) {
            roundToolOutputs.push({
              type: "function_call_output",
              call_id: callId,
              output: result.message,
            });
          }
        }
      }

      if (!roundHadTools || !roundToolOutputs.length) break;
      nextInput = roundToolOutputs;
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
