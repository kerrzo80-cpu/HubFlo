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

/**
 * Ask live OpenAI for UK merchant budget unit costs on every line.
 * Fills £0 lines; optionally refreshes lines already tagged blake-budget.
 * Falls back to rate-library guides when OpenAI is offline.
 */
export async function budgetPriceKitWithBlake(
  lines: KitLine[],
  options: { forceRefreshBudget?: boolean; context?: string } = {},
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

  const payload = libraryFirst.map((line) => ({
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
      body: JSON.stringify({
        model: openAi.model || "gpt-4.1-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return strict JSON only. You are Blake pricing a UK plumbing/heating materials list for budget estimating. Use typical 2024–2026 UK merchant trade prices (Wolseley / City Plumbing / Screwfix trade ballpark). These are BUDGET costs for comparing to supplier quotes later — not firm quotes.",
          },
          {
            role: "user",
            content: [
              "For each line return a budget unitCost in GBP (ex VAT).",
              "If a unitCost is already present, you may refine it if clearly wrong; otherwise keep a sensible UK trade figure.",
              "Never return 0 unless the item is truly free. Prefer a provisional budget over blank.",
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
      const summary = summariseGuidePricing(libraryFirst);
      return {
        lines: libraryFirst,
        aiUsed: false,
        connected: true,
        model: openAi.model,
        error: detail,
        pricedCount: summary.pricedLines,
        stillOpenCount: summary.rfqLines,
        budgetTotal: summary.materialCost,
      };
    }

    const text = extractChatText(body);
    if (!text) {
      const summary = summariseGuidePricing(libraryFirst);
      return {
        lines: libraryFirst,
        aiUsed: false,
        connected: true,
        error: "Empty OpenAI budget response",
        pricedCount: summary.pricedLines,
        stillOpenCount: summary.rfqLines,
        budgetTotal: summary.materialCost,
      };
    }

    const parsed = JSON.parse(text) as { lines?: unknown };
    const byId = new Map<string, number>();
    if (Array.isArray(parsed.lines)) {
      for (const row of parsed.lines) {
        if (!row || typeof row !== "object") continue;
        const item = row as { id?: unknown; unitCost?: unknown; unit_cost?: unknown };
        const id = String(item.id || "").trim();
        const cost = Number(item.unitCost ?? item.unit_cost);
        if (!id || !Number.isFinite(cost) || cost < 0) continue;
        byId.set(id, Math.round(cost * 100) / 100);
      }
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
      pricedCount: summary.pricedLines,
      stillOpenCount: summary.rfqLines,
      budgetTotal: Number(
        priced.reduce((sum, line) => sum + line.qty * (line.unitCost || 0), 0).toFixed(2),
      ),
    };
  } catch (err) {
    const summary = summariseGuidePricing(libraryFirst);
    return {
      lines: libraryFirst,
      aiUsed: false,
      connected: true,
      error: err instanceof Error ? err.message : "Budget pricing failed",
      pricedCount: summary.pricedLines,
      stillOpenCount: summary.rfqLines,
      budgetTotal: summary.materialCost,
    };
  }
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
