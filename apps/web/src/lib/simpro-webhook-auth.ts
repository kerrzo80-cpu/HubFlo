import { isStrictSecurityMode } from "@/lib/runtime-security";

/**
 * Validate inbound simPRO webhook shared secret.
 * Fail closed in live/users/production when the secret env var is unset.
 */
export function isValidWebhookSecret(headers: Headers) {
  const expected = process.env.SIMPRO_WEBHOOK_SECRET?.trim();
  if (!expected) {
    return !isStrictSecurityMode();
  }

  const headerSecret =
    headers.get("x-simpro-secret") ||
    headers.get("x-nexa-simpro-secret") ||
    headers.get("x-webhook-secret") ||
    headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerSecret === expected;
}
