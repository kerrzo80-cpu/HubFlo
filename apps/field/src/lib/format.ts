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
