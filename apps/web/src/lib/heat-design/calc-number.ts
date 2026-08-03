export function numberFromInput(value: string | number | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isDecimalDraft(value: string) {
  return /^(\d+)?([.,]\d*)?$/.test(value);
}
