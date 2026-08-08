export type NumberingKind = "lead" | "quote" | "job" | "invoice" | "application" | "purchaseOrder";

export type NumberingSettingsLike = Record<string, unknown> | undefined | null;

type NumberingConfig = {
  prefixField: string;
  nextField: string;
  fallbackPrefix: string;
  fallbackNext: number;
};

const numberingConfigs: Record<NumberingKind, NumberingConfig> = {
  lead: {
    prefixField: "leadPrefix",
    nextField: "leadNextNumber",
    fallbackPrefix: "L",
    fallbackNext: 1001,
  },
  quote: {
    prefixField: "quotePrefix",
    nextField: "quoteNextNumber",
    fallbackPrefix: "Q",
    fallbackNext: 2001,
  },
  job: {
    prefixField: "jobPrefix",
    nextField: "jobNextNumber",
    fallbackPrefix: "J",
    fallbackNext: 1001,
  },
  invoice: {
    prefixField: "invoicePrefix",
    nextField: "invoiceNextNumber",
    fallbackPrefix: "INV",
    fallbackNext: 3001,
  },
  application: {
    prefixField: "applicationPrefix",
    nextField: "applicationNextNumber",
    fallbackPrefix: "AFP",
    fallbackNext: 1001,
  },
  purchaseOrder: {
    prefixField: "purchaseOrderPrefix",
    nextField: "purchaseOrderNextNumber",
    fallbackPrefix: "PO",
    fallbackNext: 1001,
  },
};

function settingValue(settings: NumberingSettingsLike, field: string) {
  return settings && Object.prototype.hasOwnProperty.call(settings, field)
    ? settings[field]
    : undefined;
}

export function normalizeReferencePrefix(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  const cleaned = text.replace(/[^a-z0-9-]/gi, "").replace(/-+$/g, "");
  return (cleaned || fallback).toUpperCase();
}

export function referenceNumber(value: string | undefined | null) {
  const matches = String(value ?? "").match(/\d+/g);
  const last = matches?.at(-1);
  const parsed = last ? Number(last) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Newest-first by sequential reference number (higher number first). */
export function compareReferenceDesc(left?: string | null, right?: string | null) {
  const byNumber = referenceNumber(right) - referenceNumber(left);
  if (byNumber !== 0) return byNumber;
  return String(right ?? "").localeCompare(String(left ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

/** Oldest-first by sequential reference number (lower number first). */
export function compareReferenceAsc(left?: string | null, right?: string | null) {
  return -compareReferenceDesc(left, right);
}

/** Parse values that are safe to compare as timestamps (ISO or "08 Aug 2026 …"). */
export function sortableDateValue(value?: string | null) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  // Keep calendar dates timezone-stable so issuedDate order does not flip near midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(text)) {
    const time = Date.parse(text);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  if (/^\d{1,2} [A-Za-z]{3,9} \d{4}/.test(text)) {
    const time = Date.parse(text);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  return null;
}

function externalIdNumber(value?: string | null) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Newest-first for directory lists.
 *
 * Important: simPRO imports historically processed newest rows first while NeXa
 * assigned ascending refs, so for imported rows a *lower* NeXa ref is newer.
 * Native in-app rows keep the lead-style rule (higher ref = newer).
 */
export function compareNewestRecord(
  left: { ref?: string | null; date?: string | null; externalId?: string | null },
  right: { ref?: string | null; date?: string | null; externalId?: string | null },
) {
  const leftDate = sortableDateValue(left.date);
  const rightDate = sortableDateValue(right.date);
  if (leftDate && rightDate && leftDate !== rightDate) {
    return rightDate < leftDate ? -1 : 1;
  }

  const leftImported = Boolean(String(left.externalId ?? "").trim());
  const rightImported = Boolean(String(right.externalId ?? "").trim());

  if (leftImported && rightImported) {
    // Newest-first simPRO import assigned the lowest NeXa refs to the newest rows.
    // Prefer that over external ids — ids are not always recency-ordered in practice.
    const byRef = compareReferenceAsc(left.ref, right.ref);
    if (byRef !== 0) return byRef;
    return externalIdNumber(right.externalId) - externalIdNumber(left.externalId);
  }

  // Native rows (and POs without an external id): higher ref / newer date first.
  if (leftDate && !rightDate) return -1;
  if (!leftDate && rightDate) return 1;

  // Brand-new local rows should sit above historical imports.
  if (!leftImported && rightImported) return -1;
  if (leftImported && !rightImported) return 1;

  return compareReferenceDesc(left.ref, right.ref);
}

export function nextReferenceNumber(
  kind: NumberingKind,
  settings: NumberingSettingsLike,
  existingRefs: Array<string | undefined | null>,
) {
  const config = numberingConfigs[kind];
  const configured = Number(settingValue(settings, config.nextField));
  const hasConfiguredNext = Number.isFinite(configured) && configured > 0;
  const configuredNext = hasConfiguredNext ? Math.floor(configured) : config.fallbackNext;
  const existingFloor = hasConfiguredNext ? 0 : config.fallbackNext - 1;
  const existingNext = Math.max(existingFloor, ...existingRefs.map(referenceNumber)) + 1;
  return Math.max(configuredNext, existingNext);
}

export function numberedReference(
  kind: NumberingKind,
  settings: NumberingSettingsLike,
  existingRefs: Array<string | undefined | null>,
) {
  const config = numberingConfigs[kind];
  const prefix = normalizeReferencePrefix(settingValue(settings, config.prefixField), config.fallbackPrefix);
  return `${prefix}-${nextReferenceNumber(kind, settings, existingRefs)}`;
}

export function numberingPrefix(kind: NumberingKind, settings: NumberingSettingsLike) {
  const config = numberingConfigs[kind];
  return normalizeReferencePrefix(settingValue(settings, config.prefixField), config.fallbackPrefix);
}
