/**
 * Sanitize Simpro API payloads before saving fixtures or returning summaries.
 * Never leave tokens, secrets, or unnecessary PII in committed fixtures.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const SENSITIVE_KEY =
  /(token|secret|password|authorization|api[_-]?key|refresh|client[_-]?secret|bearer|cookie|session)/i;

const PII_KEY =
  /(email|phone|mobile|fax|abn|acn|tax[_-]?number|ssn|dob|dateofbirth|bank|iban|sort[_-]?code|account[_-]?number)/i;

const CONTACT_NAME_KEY = /^(contact|primarycontact|customercontact|firstname|lastname|fullname)$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactString(key: string, value: string): string {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (PII_KEY.test(key)) {
    if (value.includes("@")) return "redacted@example.com";
    if (/\d{6,}/.test(value)) return "REDACTED";
    return "REDACTED";
  }
  if (CONTACT_NAME_KEY.test(key) && value.trim()) return "Redacted Contact";
  return value;
}

export function sanitizeSimproPayload(value: unknown, keyHint = ""): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactString(keyHint, value);
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeSimproPayload(item, `${keyHint}[${index}]`));
  }
  if (!isPlainObject(value)) return String(value);

  const out: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeSimproPayload(child, key);
  }
  return out;
}

export function summarizeSimproShape(value: unknown, maxDepth = 4, depth = 0): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (!value.length) return [];
    if (depth >= maxDepth) return [`array(${value.length})`];
    return [summarizeSimproShape(value[0], maxDepth, depth + 1)];
  }
  if (!isPlainObject(value)) return typeof value;
  if (depth >= maxDepth) return "object";
  const out: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = summarizeSimproShape(child, maxDepth, depth + 1);
  }
  return out;
}

export function safeMissingFieldAccess<T>(
  record: Record<string, unknown> | null | undefined,
  path: string[],
  fallback: T,
): T {
  let current: unknown = record;
  for (const part of path) {
    if (!isPlainObject(current)) return fallback;
    current = current[part];
    if (current === null || current === undefined) return fallback;
  }
  return current as T;
}
