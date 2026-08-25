/** Shared AbortSignal helpers for outbound HTTP (OpenAI, simPRO, etc.). */

export function abortSignalAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined | null>
): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const signal = mergeAbortSignals(init?.signal, abortSignalAfter(timeoutMs));
  return fetch(input, { ...init, signal });
}
