import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

type UsageEntry = {
  id: string;
  tenantId: string;
  month: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  createdAt: string;
};

type UsageAggregate = {
  tenantId: string;
  month: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  calls: number;
  byModel: Record<string, {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    calls: number;
  }>;
};

type UsageStore = {
  entries: UsageEntry[];
};

type ModelPrice = { input: number; cachedInput: number; output: number };

const STORE_KEY = "blake-ai-usage-v1";
const store = loadServerStore<UsageStore>(STORE_KEY, { entries: [] });

// USD per 1M tokens. Keep this list deliberately small and explicit; unknown models
// are still metered for tokens but cost remains zero until a price is configured.
const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-5.6-luna": { input: 0.20, cachedInput: 0.02, output: 1.20 },
  "gpt-5.6-terra": { input: 2.00, cachedInput: 0.20, output: 12.00 },
  "gpt-5.6-sol": { input: 4.00, cachedInput: 0.40, output: 20.00 },
};

function refresh() {
  const snapshot = readServerStoreSnapshot(STORE_KEY) as UsageStore | null;
  store.entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
}

function persist() {
  // Keep detailed recent entries for troubleshooting while capping store growth.
  store.entries = store.entries
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5000);
  writeServerStore(STORE_KEY, store);
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function configuredTenantId() {
  return process.env.NEXA_TENANT_KEY?.trim() || "default";
}

function money(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateOpenAiCostUsd(input: {
  model: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}) {
  const price = MODEL_PRICES[input.model];
  if (!price) return 0;
  const cached = Math.max(0, Math.min(input.inputTokens, input.cachedInputTokens || 0));
  const uncached = Math.max(0, input.inputTokens - cached);
  return money(
    (uncached / 1_000_000) * price.input
    + (cached / 1_000_000) * price.cachedInput
    + (input.outputTokens / 1_000_000) * price.output,
  );
}

export function recordBlakeAiUsage(input: {
  tenantId?: string;
  model: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}) {
  refresh();
  const now = new Date();
  const entry: UsageEntry = {
    id: `ai-usage-${crypto.randomUUID()}`,
    tenantId: input.tenantId?.trim() || configuredTenantId(),
    month: monthKey(now),
    model: input.model,
    inputTokens: Math.max(0, Math.round(input.inputTokens || 0)),
    cachedInputTokens: Math.max(0, Math.round(input.cachedInputTokens || 0)),
    outputTokens: Math.max(0, Math.round(input.outputTokens || 0)),
    estimatedCostUsd: estimateOpenAiCostUsd({
      model: input.model,
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
    }),
    createdAt: now.toISOString(),
  };
  store.entries.unshift(entry);
  persist();
  return entry;
}

export function getBlakeAiUsage(input: { tenantId?: string; month?: string } = {}): UsageAggregate {
  refresh();
  const tenantId = input.tenantId?.trim() || configuredTenantId();
  const month = input.month?.trim() || monthKey();
  const entries = store.entries.filter((entry) => entry.tenantId === tenantId && entry.month === month);
  const aggregate: UsageAggregate = {
    tenantId,
    month,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    calls: entries.length,
    byModel: {},
  };
  for (const entry of entries) {
    aggregate.inputTokens += entry.inputTokens;
    aggregate.cachedInputTokens += entry.cachedInputTokens;
    aggregate.outputTokens += entry.outputTokens;
    aggregate.estimatedCostUsd += entry.estimatedCostUsd;
    const model = aggregate.byModel[entry.model] || {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      calls: 0,
    };
    model.inputTokens += entry.inputTokens;
    model.cachedInputTokens += entry.cachedInputTokens;
    model.outputTokens += entry.outputTokens;
    model.estimatedCostUsd += entry.estimatedCostUsd;
    model.calls += 1;
    aggregate.byModel[entry.model] = model;
  }
  aggregate.estimatedCostUsd = money(aggregate.estimatedCostUsd);
  for (const model of Object.values(aggregate.byModel)) model.estimatedCostUsd = money(model.estimatedCostUsd);
  return aggregate;
}

function envMoney(name: string) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getBlakeAiSpendGuard(tenantId?: string) {
  const usage = getBlakeAiUsage({ tenantId });
  const warningUsd = envMoney("BLAKE_AI_MONTHLY_WARNING_USD");
  const limitUsd = envMoney("BLAKE_AI_MONTHLY_LIMIT_USD");
  return {
    ...usage,
    warningUsd,
    limitUsd,
    warningReached: warningUsd !== undefined && usage.estimatedCostUsd >= warningUsd,
    limitReached: limitUsd !== undefined && usage.estimatedCostUsd >= limitUsd,
    remainingUsd: limitUsd === undefined ? undefined : money(Math.max(0, limitUsd - usage.estimatedCostUsd)),
  };
}

export function extractOpenAiUsage(body: unknown, requestedModel?: string) {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : null;
  if (!usage) return null;
  const model = typeof record.model === "string" && record.model.trim() ? record.model : requestedModel || "unknown";
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const inputDetails = (usage.input_tokens_details ?? usage.prompt_tokens_details) as Record<string, unknown> | undefined;
  const cachedInputTokens = Number(inputDetails?.cached_tokens ?? 0) || 0;
  if (!inputTokens && !outputTokens) return null;
  return { model, inputTokens, outputTokens, cachedInputTokens };
}

export function resetBlakeAiUsageForTests() {
  store.entries = [];
  persist();
}
