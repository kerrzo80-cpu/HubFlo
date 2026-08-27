/** Process-local gate: hub PUT must not full-save while passaround is in flight. */

let passaroundBusyUntilMs = 0;

export function markPassaroundBusy(ms = 45_000) {
  const until = Date.now() + Math.max(1_000, ms);
  passaroundBusyUntilMs = Math.max(passaroundBusyUntilMs, until);
}

export function isPassaroundBusy() {
  return Date.now() < passaroundBusyUntilMs;
}
