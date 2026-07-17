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
