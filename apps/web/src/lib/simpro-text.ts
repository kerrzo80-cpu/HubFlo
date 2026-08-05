/**
 * Plain-text helpers for simPRO import fields.
 * Quote/job Descriptions often arrive as HTML email bodies with &nbsp; entities.
 */

export function stripSimproHtml(value: string) {
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Prefer a short title over a long HTML/email body for list cards. */
export function simproPlainDescription(
  fields: { title?: string; body?: string },
  fallback: string,
  options?: { maxLength?: number; preferTitle?: boolean },
) {
  const maxLength = options?.maxLength ?? 72;
  const preferTitle = options?.preferTitle ?? true;
  const rawBody = fields.body || "";
  const title = stripSimproHtml(fields.title || "");
  const body = stripSimproHtml(rawBody);

  let chosen = "";
  if (preferTitle && title) {
    chosen = title;
  } else if (title && (looksLikeHtml(rawBody) || (body && body.length > Math.max(100, title.length * 3)))) {
    chosen = title;
  } else if (body) {
    chosen = body;
  } else if (title) {
    chosen = title;
  } else {
    return fallback;
  }

  if (chosen.length <= maxLength) return chosen;
  return `${chosen.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function looksLikeHtml(value: string) {
  return /<\s*[a-z][\s\S]*>/i.test(value) || /&nbsp;/i.test(value);
}
