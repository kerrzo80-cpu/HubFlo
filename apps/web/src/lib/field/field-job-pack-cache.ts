"use client";

import type { FieldScheduleItem } from "@/lib/field/types";

export type FieldJobPackWorkflow = {
  photos: Array<{
    id: string;
    name: string;
    type: string;
    uploadedBy: string;
    uploadedAt: string;
    url?: string;
    mimeType?: string;
    size?: number;
    storageKey?: string;
  }>;
  notes: Array<{
    id: string;
    text: string;
    visibility: string;
    createdBy: string;
    createdAt: string;
  }>;
  poRequests: Array<{
    id: string;
    poNumber?: string;
    supplier: string;
    note: string;
    costCentreName?: string;
    createdBy: string;
    createdAt: string;
    status: string;
  }>;
  outcome: {
    status: string;
    note: string;
    createdBy: string;
    createdAt: string;
  } | null;
};

export type FieldDayworkSheetSnapshot = {
  costCentreId?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type FieldJobPackSnapshot = {
  scheduleId: string;
  job: FieldScheduleItem;
  workflow: FieldJobPackWorkflow;
  dayworkSheets: FieldDayworkSheetSnapshot[];
  savedAt: string;
};

const PACK_KEY_PREFIX = "nexa-field-job-pack-v1-";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function packKey(scheduleId: string) {
  return `${PACK_KEY_PREFIX}${scheduleId}`;
}

export function saveFieldJobPack(snapshot: FieldJobPackSnapshot) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(packKey(snapshot.scheduleId), JSON.stringify(snapshot));
  } catch {
    // Quota or private mode — online reload still works.
  }
}

export function readFieldJobPack(scheduleId: string): FieldJobPackSnapshot | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(packKey(scheduleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FieldJobPackSnapshot>;
    if (!parsed?.job || !parsed.scheduleId) return null;
    return {
      scheduleId: String(parsed.scheduleId),
      job: parsed.job as FieldScheduleItem,
      workflow: (parsed.workflow as FieldJobPackWorkflow) ?? {
        photos: [],
        notes: [],
        poRequests: [],
        outcome: null,
      },
      dayworkSheets: Array.isArray(parsed.dayworkSheets) ? parsed.dayworkSheets : [],
      savedAt: String(parsed.savedAt || ""),
    };
  } catch {
    return null;
  }
}
