/**
 * Live Blake budget pricing — UK trade ballpark unit costs via OpenAI.
 * Not a merchant quote. Tag as blake-budget so office can amend when RFQ returns.
 */

import { applyGuidePricesToKit, summariseGuidePricing } from "@/lib/ai-guide-prices";
import type { KitLine, KitPricingSource } from "@/lib/heat-design/types";
import {
  pricingStateFromSource,
  stampBudgetPrice,
  stampGuidePrice,
  stampRfqPrice,
} from "@/lib/price-ledger";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

const BUDGET_NOTE =
  "Blake budget (UK trade ballpark) — amend to supplier quote when uploaded";

export type BlakeBudgetPriceOptions = {
  forceRefreshBudget?: boolean;
  context?: string;
  /**
   * Tender BoQ mode: instruct OpenAI to omit costs when unsure.
   * Prefer blank over invented £0 / fantasy rates.
   */
  preferBlankWhenUnsure?: boolean;
  /** OpenAI chunk size (lines per request). Defaults to one request. */
  chunkSize?: number;
  /** Per-chunk OpenAI timeout in ms. Default 45s. */
  timeoutMs?: number;
};

function extractChatText(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content.trim() : "";
}

function tagLine(
  line: KitLine,
  unitCost: number,
  source: KitPricingSource,
  note?: string,
): KitLine {
  if (!(unitCost > 0)) {
    return stampRfqPrice({ ...line, unitCost: 0 }, note) as KitLine;
  }
  if (source === "blake-budget") {
    return stampBudgetPrice(line, unitCost, note || BUDGET_NOTE) as KitLine;
  }
  if (source === "rate-library" || source === "rule" || source === "catalogue") {
    return stampGuidePrice(line, unitCost, source, note) as KitLine;
  }
  const state = pricingStateFromSource(source, unitCost);
  return {
    ...line,
    unitCost,
    pricingSource: source,
    pricingState: state,
    pricingNote: note || line.pricingNote,
    pricedAt: new Date().toISOString(),
  };
}

/** Apply rate-library / soft guides and tag pricingSource. */
export function applyTaggedGuidePrices(lines: KitLine[]): KitLine[] {
  return applyGuidePricesToKit(lines).map((line, index) => {
    const before = lines[index];
    if (!before) return line;
    if (before.unitCost > 0) {
      return tagLine(
        line,
        before.unitCost,
        before.pricingSource || "rule",
        before.pricingNote,
      );
    }
    if (line.unitCost > 0 && before.unitCost === 0) {
      return tagLine(line, line.unitCost, "rate-library", "NeXa rate library guide — amend when supplier quote lands");
    }
    return { ...line, pricingSource: before.pricingSource };
  });
}

export type BlakeBudgetPriceResult = {
  lines: KitLine[];
  aiUsed: boolean;
  connected: boolean;
  model?: string;
  error?: string;
  pricedCount: number;
  stillOpenCount: number;
  budgetTotal: number;
};

function abortSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (!(size > 0) || items.length <= size) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function askBlakeBudgetChunk(
  chunk: KitLine[],
  openAi: { apiKey: string; model: string },
  options: BlakeBudgetPriceOptions,
): Promise<{ byId: Map<string, number>; error?: string }> {
  const byId = new Map<string, number>();
  const preferBlank = Boolean(options.preferBlankWhenUnsure);
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 45_000;
  const payload = chunk.map((line) => ({
    id: line.id,
    description: line.description,
    category: line.category,
    qty: line.qty,
    unit: line.unit || "nr",
    unitCost: line.unitCost > 0 ? line.unitCost : null,
  }));

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAi.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: abortSignal(timeoutMs),
      body: JSON.stringify({
        model: openAi.model || "gpt-4.1-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: preferBlank
              ? "Return strict JSON only. You are Blake pricing a UK plumbing/heating Bill of Quantities for budget estimating. Use typical 2024–2026 UK merchant trade prices (Wolseley / City Plumbing / Screwfix trade ballpark). These are BUDGET guide unit rates — not firm quotes. If you are not confident what the item is, omit it (do not invent a rate, do not return 0)."
              : "Return strict JSON only. You are Blake pricing a UK plumbing/heating materials list for budget estimating. Use typical 2024–2026 UK merchant trade prices (Wolseley / City Plumbing / Screwfix trade ballpark). These are BUDGET costs for comparing to supplier quotes later — not firm quotes.",
          },
          {
            role: "user",
            content: [
              preferBlank
                ? "For each line you can price confidently, return a budget unitCost in GBP (ex VAT)."
                : "For each line return a budget unitCost in GBP (ex VAT).",
              preferBlank
                ? "If unsure of the item, trade unit, or a sensible UK rate, omit that line entirely. Never return 0. Prefer blank over a guess."
                : "If a unitCost is already present, you may refine it if clearly wrong; otherwise keep a sensible UK trade figure. Never return 0 unless the item is truly free. Prefer a provisional budget over blank.",
              "Return JSON: { lines: [{ id, unitCost, note? }] }",
              options.context ? `Job context: ${options.context}` : "",
              JSON.stringify({ lines: payload }),
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        typeof (body as { error?: { message?: string } }).error?.message === "string"
          ? (body as { error: { message: string } }).error.message
          : `OpenAI HTTP ${response.status}`;
      return { byId, error: detail };
    }

    const text = extractChatText(body);
    if (!text) return { byId, error: "Empty OpenAI budget response" };

    const parsed = JSON.parse(text) as { lines?: unknown };
    if (Array.isArray(parsed.lines)) {
      for (const row of parsed.lines) {
        if (!row || typeof row !== "object") continue;
        const item = row as { id?: unknown; unitCost?: unknown; unit_cost?: unknown };
        const id = String(item.id || "").trim();
        const cost = Number(item.unitCost ?? item.unit_cost);
        if (!id || !Number.isFinite(cost) || cost <= 0) continue;
        byId.set(id, Math.round(cost * 100) / 100);
      }
    }
    return { byId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Budget pricing failed";
    const timedOut = /abort|timeout/i.test(message);
    return { byId, error: timedOut ? `OpenAI timed out after ${timeoutMs}ms` : message };
  }
}

/**
 * Ask live OpenAI for UK merchant budget unit costs on every line.
 * Fills £0 lines; optionally refreshes lines already tagged blake-budget.
 * Falls back to rate-library guides when OpenAI is offline.
 */
export async function budgetPriceKitWithBlake(
  lines: KitLine[],
  options: BlakeBudgetPriceOptions = {},
): Promise<BlakeBudgetPriceResult> {
  const openAi = getTakeoffOpenAiConfig();
  const libraryFirst = applyTaggedGuidePrices(lines);

  if (!openAi.apiKey) {
    const summary = summariseGuidePricing(libraryFirst);
    return {
      lines: libraryFirst,
      aiUsed: false,
      connected: false,
      error: "OpenAI key missing — rate-library guides only.",
      pricedCount: summary.pricedLines,
      stillOpenCount: summary.rfqLines,
      budgetTotal: summary.materialCost,
    };
  }

  const needsPrice = libraryFirst.filter(
    (line) =>
      !(line.unitCost > 0)
      || (options.forceRefreshBudget && (line.pricingSource === "blake-budget" || !line.pricingSource)),
  );

  // If library already filled everything and we're not refreshing, skip the API call.
  if (!needsPrice.length && !options.forceRefreshBudget) {
    const withBudgetTag = libraryFirst.map((line) =>
      line.unitCost > 0 && !line.pricingSource
        ? tagLine(line, line.unitCost, "rate-library")
        : line,
    );
    const summary = summariseGuidePricing(withBudgetTag);
    return {
      lines: withBudgetTag,
      aiUsed: false,
      connected: true,
      model: openAi.model,
      pricedCount: summary.pricedLines,
      stillOpenCount: summary.rfqLines,
      budgetTotal: summary.materialCost,
    };
  }

  const toAsk = needsPrice.length
    ? needsPrice
    : libraryFirst.filter(
        (line) =>
          options.forceRefreshBudget
          && (line.pricingSource === "blake-budget" || !line.pricingSource || !(line.unitCost > 0)),
      );

  const chunkSize = options.chunkSize && options.chunkSize > 0 ? options.chunkSize : toAsk.length || 1;
  const chunks = chunkArray(toAsk.length ? toAsk : libraryFirst, chunkSize);
  const byId = new Map<string, number>();
  const errors: string[] = [];

  for (const chunk of chunks) {
    const result = await askBlakeBudgetChunk(chunk, openAi, options);
    for (const [id, cost] of result.byId) byId.set(id, cost);
    if (result.error) errors.push(result.error);
  }

  const priced = libraryFirst.map((line) => {
    const aiCost = byId.get(line.id);
    if (aiCost !== undefined && aiCost > 0) {
      return tagLine(line, aiCost, "blake-budget", BUDGET_NOTE);
    }
    if (line.unitCost > 0) {
      return line.pricingSource
        ? line
        : tagLine(line, line.unitCost, "rate-library");
    }
    return line;
  });

  const summary = summariseGuidePricing(priced);
  return {
    lines: priced,
    aiUsed: byId.size > 0,
    connected: true,
    model: openAi.model,
    error: errors.length ? errors[0] : undefined,
    pricedCount: summary.pricedLines,
    stillOpenCount: summary.rfqLines,
    budgetTotal: Number(
      priced.reduce((sum, line) => sum + line.qty * (line.unitCost || 0), 0).toFixed(2),
    ),
  };
}

export function kitBudgetSummary(lines: KitLine[]) {
  const budgetLines = lines.filter((line) => line.pricingSource === "blake-budget");
  const libraryLines = lines.filter((line) => line.pricingSource === "rate-library");
  const open = lines.filter((line) => !(line.unitCost > 0));
  const total = lines.reduce((sum, line) => sum + line.qty * (line.unitCost || 0), 0);
  return {
    budgetLineCount: budgetLines.length,
    libraryLineCount: libraryLines.length,
    openLineCount: open.length,
    budgetTotal: Number(total.toFixed(2)),
    label:
      open.length > 0
        ? `Budget £${total.toFixed(0)} · ${open.length} still need a figure`
        : `Budget materials £${total.toFixed(0)} · amend when supplier quotes land`,
  };
}
