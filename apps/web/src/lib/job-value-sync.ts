/** Hold window after Complete / Ready-to-invoice so status patches don't re-enter value sync. */
export const PASSAROUND_HOLD_MS = 8000;

/** Hard stop after this many successful value rewrites in one session. */
export const JOB_VALUE_SYNC_CIRCUIT_BREAKER = 20;

export type JobValueSyncDecision =
  | { action: "skip" }
  | { action: "freeze"; history: number[] }
  | { action: "noop"; nextValue: number; history: number[] }
  | { action: "update"; nextValue: number; history: number[] };

/**
 * Decide whether centre-derived sell totals should rewrite a job header value.
 * Prevents A↔B oscillation (remap fighting hub/header) that freezes the UI during
 * Complete / Ready-to-invoice.
 */
export function decideJobValueSync(input: {
  headerValue: number;
  nextValue: number;
  lastSynced?: number;
  history?: number[];
  frozen?: boolean;
  holdActive?: boolean;
  isSimpro?: boolean;
}): JobValueSyncDecision {
  if (input.isSimpro) return { action: "skip" };
  if (input.frozen) return { action: "skip" };
  if (!Number.isFinite(input.nextValue)) return { action: "skip" };

  if (input.lastSynced === input.nextValue) return { action: "skip" };

  if (Math.abs((input.headerValue ?? 0) - input.nextValue) < 0.01) {
    return {
      action: "noop",
      nextValue: input.nextValue,
      history: input.history ?? [],
    };
  }

  const history = [...(input.history ?? []), input.nextValue].slice(-4);

  // Oscillation A↔B↔A↔B from centre remap fighting hub/defaults.
  if (
    history.length >= 4 &&
    history[0] === history[2] &&
    history[1] === history[3] &&
    history[0] !== history[1]
  ) {
    return { action: "freeze", history };
  }

  if (input.lastSynced !== undefined && input.holdActive) {
    return { action: "skip" };
  }

  return { action: "update", nextValue: input.nextValue, history };
}

/** True when recent nextValues flip A↔B↔A↔B. */
export function isOscillatingValueHistory(history: number[]): boolean {
  return (
    history.length >= 4 &&
    history[0] === history[2] &&
    history[1] === history[3] &&
    history[0] !== history[1]
  );
}
