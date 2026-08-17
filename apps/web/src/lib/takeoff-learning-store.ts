/**
 * Workspace takeoff habits Blake learns from confirms, rejects, and manual mark-up.
 * Counts only — no ML training job. Prefs = argmax with a small threshold.
 */

import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { DEFAULT_STUDIO_PIPE_SPEC_ID } from "@/lib/takeoff-studio-pipe";
import type { TakeoffTradeId } from "@/lib/takeoff-skill";

const STORE_NAME = "takeoff-learning-v1";
const MAX_EVENTS = 120;
const MIN_PREF_COUNT = 2;

export type TakeoffLearningEventType =
  | "ai_confirm"
  | "ai_reject"
  | "manual_linear"
  | "scale_choice"
  | "pipe_spec_choice";

export type TakeoffLearningEvent = {
  type: TakeoffLearningEventType;
  at: string;
  projectId?: string;
  actor?: string;
  codes?: string[];
  rejectedCodes?: string[];
  pipeSpecId?: string;
  classificationId?: string;
  scaleLabel?: string;
  trade?: TakeoffTradeId;
};

export type TakeoffLearningStore = {
  version: 1;
  tradeCounts: Record<string, number>;
  pipeSpecCounts: Record<string, number>;
  confirmedCodeCounts: Record<string, number>;
  rejectedCodeCounts: Record<string, number>;
  classificationCounts: Record<string, number>;
  scaleLabelCounts: Record<string, number>;
  recentEvents: TakeoffLearningEvent[];
  updatedAt: string;
};

export type TakeoffLearningPreferences = {
  defaultTrade: TakeoffTradeId | null;
  defaultPipeSpecId: string;
  commonCodes: string[];
  rejectedCodes: string[];
  preferredScaleLabel: string | null;
  eventCount: number;
  summary: string;
};

function emptyStore(): TakeoffLearningStore {
  return {
    version: 1,
    tradeCounts: {},
    pipeSpecCounts: {},
    confirmedCodeCounts: {},
    rejectedCodeCounts: {},
    classificationCounts: {},
    scaleLabelCounts: {},
    recentEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

function bump(map: Record<string, number>, key: string, by = 1) {
  const clean = key.trim();
  if (!clean) return;
  map[clean] = (map[clean] || 0) + by;
}

function topKey(map: Record<string, number>, min = MIN_PREF_COUNT): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(map)) {
    if (count >= min && count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function topKeys(map: Record<string, number>, limit: number, min = MIN_PREF_COUNT): string[] {
  return Object.entries(map)
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

export function getTakeoffLearningStore(): TakeoffLearningStore {
  const raw = loadServerStore<Partial<TakeoffLearningStore>>(STORE_NAME, emptyStore());
  return {
    ...emptyStore(),
    ...raw,
    version: 1,
    tradeCounts: raw.tradeCounts || {},
    pipeSpecCounts: raw.pipeSpecCounts || {},
    confirmedCodeCounts: raw.confirmedCodeCounts || {},
    rejectedCodeCounts: raw.rejectedCodeCounts || {},
    classificationCounts: raw.classificationCounts || {},
    scaleLabelCounts: raw.scaleLabelCounts || {},
    recentEvents: Array.isArray(raw.recentEvents) ? raw.recentEvents : [],
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export function recordTakeoffLearningEvent(
  input: Omit<TakeoffLearningEvent, "at"> & { at?: string },
): TakeoffLearningStore {
  const store = getTakeoffLearningStore();
  const event: TakeoffLearningEvent = {
    ...input,
    at: input.at || new Date().toISOString(),
  };

  if (event.trade) bump(store.tradeCounts, event.trade);
  if (event.pipeSpecId) bump(store.pipeSpecCounts, event.pipeSpecId);
  if (event.classificationId) bump(store.classificationCounts, event.classificationId);
  if (event.scaleLabel) bump(store.scaleLabelCounts, event.scaleLabel);

  if (event.type === "ai_reject") {
    for (const code of event.rejectedCodes || event.codes || []) bump(store.rejectedCodeCounts, code);
  } else {
    for (const code of event.codes || []) bump(store.confirmedCodeCounts, code);
    for (const code of event.rejectedCodes || []) bump(store.rejectedCodeCounts, code);
  }

  store.recentEvents = [event, ...store.recentEvents].slice(0, MAX_EVENTS);
  store.updatedAt = event.at;
  writeServerStore(STORE_NAME, store);
  return store;
}

export function takeoffLearningPreferences(store = getTakeoffLearningStore()): TakeoffLearningPreferences {
  const trade = topKey(store.tradeCounts);
  const pipeSpecId = topKey(store.pipeSpecCounts) || DEFAULT_STUDIO_PIPE_SPEC_ID;
  const commonCodes = topKeys(store.confirmedCodeCounts, 12, 1);
  /** One reject is enough — do not keep offering a class the office already threw out. */
  const rejectedCodes = topKeys(store.rejectedCodeCounts, 24, 1);
  const preferredScaleLabel = topKey(store.scaleLabelCounts, 1);
  const eventCount = store.recentEvents.length;

  const bits = [
    eventCount ? `${eventCount} lesson${eventCount === 1 ? "" : "s"}` : null,
    trade ? `trade ${trade}` : null,
    pipeSpecId ? `pipe ${pipeSpecId}` : null,
    commonCodes.length ? `keeps ${commonCodes.slice(0, 3).join(", ")}` : null,
    rejectedCodes.length ? `avoids ${rejectedCodes.slice(0, 3).join(", ")}` : null,
  ].filter(Boolean);

  return {
    defaultTrade: (trade as TakeoffTradeId | null) || null,
    defaultPipeSpecId: pipeSpecId,
    commonCodes,
    rejectedCodes,
    preferredScaleLabel,
    eventCount,
    summary: bits.length ? `Blake is learning how you take off · ${bits.join(" · ")}` : "Blake will learn from your confirms, rejects, and pipe sizes.",
  };
}

/** Drop rejected classes, then soft-rank the rest using learned keep codes. */
export function applyLearningToMeasuredRows<T extends { code: string; confidence?: string; notes?: string }>(
  rows: T[],
  prefs: TakeoffLearningPreferences,
  extraRejectedCodes: string[] = [],
): T[] {
  if (!rows.length) return rows;
  const reject = new Set(
    [...prefs.rejectedCodes, ...extraRejectedCodes].map((code) => code.trim().toUpperCase()).filter(Boolean),
  );
  const keep = new Set(prefs.commonCodes.map((code) => code.toUpperCase()));
  return [...rows]
    .filter((row) => !reject.has(String(row.code || "").toUpperCase()))
    .map((row) => {
      const code = String(row.code || "").toUpperCase();
      if (keep.has(code) && row.confidence !== "High") {
        return {
          ...row,
          confidence: "High" as const,
          notes: [row.notes, "Matches codes you usually keep"].filter(Boolean).join(" · "),
        };
      }
      return row;
    })
    .sort((a, b) => {
      const aCode = String(a.code || "").toUpperCase();
      const bCode = String(b.code || "").toUpperCase();
      const aScore = keep.has(aCode) ? 2 : 0;
      const bScore = keep.has(bCode) ? 2 : 0;
      return bScore - aScore;
    });
}
