import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypt optional tenant-provided OpenAI keys at rest.
 * Prefer NEXA_TENANT_SECRETS_KEY; otherwise derive a deployment-local key.
 * Never return plaintext to the browser.
 */
function secretsKeyMaterial() {
  const configured = process.env.NEXA_TENANT_SECRETS_KEY?.trim();
  if (configured && configured.length >= 16) {
    return createHash("sha256").update(configured).digest();
  }
  const fallbackSeed =
    process.env.NEXA_STORE_PATH?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "nexa-dev-tenant-secrets";
  return createHash("sha256").update(`nexa-tenant-secrets:${fallbackSeed}`).digest();
}

export function encryptTenantSecret(plaintext: string): string {
  const key = secretsKeyMaterial();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptTenantSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secret payload.");
  }
  const key = secretsKeyMaterial();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function maskApiKeyLastFour(apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) return "••••";
  return trimmed.slice(-4);
}
