/** UK date helpers for Field / LGSR forms (DD-MM-YYYY). */

export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function isUkDate(value: string) {
  return /^\d{2}-\d{2}-\d{4}$/.test(value.trim());
}

export function isoDateToUk(value: string) {
  const trimmed = value.trim();
  if (!isIsoDate(trimmed)) return trimmed;
  const [year, month, day] = trimmed.split("-");
  return `${day}-${month}-${year}`;
}

export function ukDateToIso(value: string) {
  const trimmed = value.trim();
  if (isIsoDate(trimmed)) return trimmed;
  if (!isUkDate(trimmed)) return "";
  const [day, month, year] = trimmed.split("-");
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day)
  ) {
    return "";
  }
  return iso;
}

/** Prefer UK display; convert legacy ISO values when needed. */
export function toUkDateDisplay(value?: string | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (isUkDate(trimmed)) return trimmed;
  if (isIsoDate(trimmed)) return isoDateToUk(trimmed);
  return trimmed;
}

/** UK date + time for signed Daywork / action alerts (DD-MM-YYYY HH:MM). */
export function toUkDateTimeDisplay(value?: string | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return toUkDateDisplay(trimmed);
  const date = new Date(parsed);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

/** Calendar inputs need ISO; accept UK or ISO stored values. */
export function toDateInputValue(value?: string | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (isIsoDate(trimmed)) return trimmed;
  return ukDateToIso(trimmed);
}

export function isValidUkOrIsoDate(value: string) {
  const trimmed = value.trim();
  if (isUkDate(trimmed)) return Boolean(ukDateToIso(trimmed));
  if (isIsoDate(trimmed)) return Boolean(ukDateToIso(isoDateToUk(trimmed)));
  return false;
}
