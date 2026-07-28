export function formatDuration(hours: number) {
  if (Number.isInteger(hours)) return `${hours}h`;
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  return wholeHours ? `${wholeHours}h ${minutes}m` : `${minutes}m`;
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function hoursBetween(start: string, end: string, breakMinutes = 0) {
  const startParts = start.split(":").map(Number);
  const endParts = end.split(":").map(Number);
  const startHour = startParts[0] ?? Number.NaN;
  const startMinute = startParts[1] ?? Number.NaN;
  const endHour = endParts[0] ?? Number.NaN;
  const endMinute = endParts[1] ?? Number.NaN;
  if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) return 0;
  const worked = Math.max(0, endHour * 60 + endMinute - (startHour * 60 + startMinute) - Math.max(0, breakMinutes));
  return Number((worked / 60).toFixed(2));
}

export function minutesFromTime(value: string) {
  const parts = value.split(":").map(Number);
  const hours = parts[0] ?? Number.NaN;
  const minutes = parts[1] ?? Number.NaN;
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

export function todayLabel(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function isoDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export function shiftMonthIso(dateIso: string, deltaMonths: number) {
  const date = new Date(`${dateIso.slice(0, 7)}-01T12:00:00`);
  date.setMonth(date.getMonth() + deltaMonths);
  return `${isoDate(date).slice(0, 7)}-01`;
}

export function startOfWeekIso(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  const day = date.getDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return isoDate(date);
}

export function weekdayShort(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
}

export function monthYearLabel(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}
