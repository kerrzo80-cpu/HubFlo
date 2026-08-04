import {
  decryptTenantSecret,
  encryptTenantSecret,
  maskApiKeyLastFour,
} from "@/lib/tenancy/secret-crypto";
import {
  getTenantAiSettings,
  writeTenantAiSettings,
} from "@/lib/tenancy/tenant-store";
import { defaultTenantAiSettings, type TenantAiSettings } from "@/lib/tenancy/types";
import { resolveOpenAiApiKey, openAiKeySource } from "@/lib/openai-env";

export type TenantAiPublicSettings = Omit<TenantAiSettings, "encryptedApiKey"> & {
  hasTenantApiKey: boolean;
  apiKeyLastFour?: string;
  keySource: "tenant" | "platform-env" | "platform-in-app" | "none";
};

export function toPublicTenantAiSettings(settings: TenantAiSettings): TenantAiPublicSettings {
  const platformSource = openAiKeySource();
  const hasTenantApiKey = Boolean(settings.encryptedApiKey);
  let keySource: TenantAiPublicSettings["keySource"] = "none";
  if (hasTenantApiKey) keySource = "tenant";
  else if (platformSource === "env") keySource = "platform-env";
  else if (platformSource === "in-app") keySource = "platform-in-app";

  return {
    tenantId: settings.tenantId,
    enabled: settings.enabled,
    tone: settings.tone,
    assistantName: settings.assistantName,
    instructions: settings.instructions,
    tradeType: settings.tradeType,
    permissions: { ...settings.permissions },
    usageLimits: { ...settings.usageLimits },
    model: settings.model,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
    hasTenantApiKey,
    apiKeyLastFour: hasTenantApiKey ? settings.apiKeyLastFour : undefined,
    keySource,
  };
}

export function getPublicTenantAiSettings(tenantId: string) {
  return toPublicTenantAiSettings(getTenantAiSettings(tenantId));
}

/**
 * Resolve OpenAI key for a tenant.
 * Order: tenant-provided encrypted key → platform env / in-app key.
 * Never expose the key to the client.
 */
export function resolveTenantOpenAiApiKey(tenantId: string): {
  apiKey: string;
  model: string;
  source: TenantAiPublicSettings["keySource"];
  settings: TenantAiSettings;
} {
  const settings = getTenantAiSettings(tenantId);
  if (settings.encryptedApiKey) {
    try {
      return {
        apiKey: decryptTenantSecret(settings.encryptedApiKey),
        model: settings.model || "gpt-4.1-mini",
        source: "tenant",
        settings,
      };
    } catch {
      // Fall through to platform key if decrypt fails.
    }
  }
  const platformKey = resolveOpenAiApiKey();
  const platformSource = openAiKeySource();
  return {
    apiKey: platformKey,
    model: settings.model || "gpt-4.1-mini",
    source:
      platformSource === "env"
        ? "platform-env"
        : platformSource === "in-app"
          ? "platform-in-app"
          : "none",
    settings,
  };
}

export function updateTenantAiSettings(
  tenantId: string,
  patch: Partial<TenantAiSettings> & { apiKey?: string; revokeApiKey?: boolean },
  updatedBy?: string,
): TenantAiPublicSettings {
  const current = getTenantAiSettings(tenantId) || defaultTenantAiSettings(tenantId);
  const next: TenantAiSettings = {
    ...current,
    enabled: patch.enabled ?? current.enabled,
    tone: patch.tone?.trim() || current.tone,
    assistantName: patch.assistantName?.trim() || current.assistantName,
    instructions: patch.instructions?.trim() || current.instructions,
    tradeType: patch.tradeType?.trim() || current.tradeType,
    permissions: {
      ...current.permissions,
      ...(patch.permissions || {}),
    },
    usageLimits: {
      ...current.usageLimits,
      ...(patch.usageLimits || {}),
    },
    model: patch.model?.trim() || current.model,
    encryptedApiKey: current.encryptedApiKey,
    apiKeyLastFour: current.apiKeyLastFour,
    updatedAt: new Date().toISOString(),
    updatedBy,
    tenantId,
  };

  if (patch.revokeApiKey) {
    delete next.encryptedApiKey;
    delete next.apiKeyLastFour;
  } else if (patch.apiKey?.trim()) {
    const apiKey = patch.apiKey.trim();
    if (!apiKey.startsWith("sk-") || apiKey.length < 20) {
      throw new Error("OpenAI API keys should start with sk- and look complete.");
    }
    next.encryptedApiKey = encryptTenantSecret(apiKey);
    next.apiKeyLastFour = maskApiKeyLastFour(apiKey);
  }

  writeTenantAiSettings(next);
  return toPublicTenantAiSettings(next);
}
