export function numberFromInput(value: string | number | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isDecimalDraft(value: string) {
  return /^(\d+)?([.,]\d*)?$/.test(value);
}

/** Allows optional leading `-` for outdoor design temps (e.g. `-5`). */
export function isSignedDecimalDraft(value: string) {
  return /^-?(\d+)?([.,]\d*)?$/.test(value);
}

/** UK-ish outdoor design range (°C). */
export function clampDesignExternalTemp(value: number) {
  if (!Number.isFinite(value)) return -3;
  return Math.max(-20, Math.min(20, value));
}
