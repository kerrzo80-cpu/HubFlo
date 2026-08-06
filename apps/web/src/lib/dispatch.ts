/** Shared dispatch helpers: travel buffers, clash detection, run sheets. */

export const DEFAULT_TRAVEL_BUFFER_MINUTES = 20;

export function timeToMinutes(value: string) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(total: number) {
  const clamped = Math.max(0, Math.round(total));
  const hours = Math.floor(clamped / 60) % 24;
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseTimeRange(range: string): { start: number; end: number } | null {
  const parts = String(range || "")
    .split(/[-–—]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    const start = timeToMinutes(parts[0] || "");
    if (!Number.isFinite(start)) return null;
    return { start, end: start + 60 };
  }
  const start = timeToMinutes(parts[0]!);
  const end = timeToMinutes(parts[1]!);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/**
 * True when two ranges overlap or the gap between them is under the travel buffer.
 * Buffer is a one-sided gap requirement (need N minutes after a job ends before the next starts).
 */
export function rangesClashWithTravelBuffer(
  a: { start: number; end: number },
  b: { start: number; end: number },
  travelBufferMinutes = DEFAULT_TRAVEL_BUFFER_MINUTES,
) {
  const buffer = Math.max(0, travelBufferMinutes);
  return a.start < b.end + buffer && b.start < a.end + buffer;
}

export type DispatchBooking = {
  id: string;
  engineerName: string;
  date: string;
  start: string;
  end: string;
  label: string;
  customer?: string;
  address?: string;
  jobRef?: string;
};

export type DispatchClash = {
  a: DispatchBooking;
  b: DispatchBooking;
  travelBufferMinutes: number;
  detail: string;
};

export function findDispatchClashes(
  bookings: DispatchBooking[],
  travelBufferMinutes = DEFAULT_TRAVEL_BUFFER_MINUTES,
): DispatchClash[] {
  const clashes: DispatchClash[] = [];
  const byKey = new Map<string, DispatchBooking[]>();
  for (const booking of bookings) {
    const key = `${booking.engineerName.toLowerCase()}|${booking.date}`;
    const list = byKey.get(key) ?? [];
    list.push(booking);
    byKey.set(key, list);
  }

  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const left = sorted[i]!;
        const right = sorted[j]!;
        const a = { start: timeToMinutes(left.start), end: timeToMinutes(left.end) };
        const b = { start: timeToMinutes(right.start), end: timeToMinutes(right.end) };
        if (!Number.isFinite(a.start) || !Number.isFinite(b.start)) continue;
        if (!rangesClashWithTravelBuffer(a, b, travelBufferMinutes)) continue;
        clashes.push({
          a: left,
          b: right,
          travelBufferMinutes,
          detail: `${left.engineerName}: ${left.label} (${left.start}-${left.end}) clashes with ${right.label} (${right.start}-${right.end}) including ${travelBufferMinutes}m travel.`,
        });
      }
    }
  }
  return clashes;
}

export type RunSheetJob = {
  start: string;
  end: string;
  jobRef: string;
  customer: string;
  address: string;
  description: string;
  phone?: string;
  costCentre?: string;
  travelAfterMinutes?: number;
};

export function buildRunSheetHtml(input: {
  engineerName: string;
  date: string;
  companyName?: string;
  jobs: RunSheetJob[];
  travelBufferMinutes?: number;
}) {
  const buffer = input.travelBufferMinutes ?? DEFAULT_TRAVEL_BUFFER_MINUTES;
  const rows = input.jobs
    .slice()
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
    .map((job, index, all) => {
      const next = all[index + 1];
      const gap =
        next && Number.isFinite(timeToMinutes(next.start)) && Number.isFinite(timeToMinutes(job.end))
          ? timeToMinutes(next.start) - timeToMinutes(job.end)
          : null;
      const travelWarn = gap !== null && gap < buffer;
      return `<tr class="${travelWarn ? "travel-tight" : ""}">
        <td>${job.start}–${job.end}</td>
        <td><strong>${job.jobRef}</strong><br/><span>${job.customer}</span></td>
        <td>${job.address || "—"}</td>
        <td>${job.description || "—"}</td>
        <td>${job.phone || "—"}</td>
        <td>${gap === null ? "—" : travelWarn ? `${gap}m (under ${buffer}m travel)` : `${gap}m`}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8"/>
<title>Run sheet · ${input.engineerName} · ${input.date}</title>
<style>
  body { font-family: Georgia, serif; color: #122026; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #5b6b73; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #d7e0e5; padding: 8px 6px; text-align: left; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #5b6b73; }
  .travel-tight td { background: #fff6e8; }
  .banner { background: #e8f4fa; border-left: 4px solid #38A1CE; padding: 10px 12px; margin-bottom: 16px; }
  @media print { body { margin: 12px; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="banner"><strong>${input.companyName || "EWG"} run sheet</strong> · travel buffer ${buffer} minutes between jobs</div>
  <h1>${input.engineerName}</h1>
  <p class="meta">${input.date} · ${input.jobs.length} job${input.jobs.length === 1 ? "" : "s"}</p>
  <p class="no-print"><button onclick="window.print()">Print</button></p>
  <table>
    <thead><tr><th>Time</th><th>Job</th><th>Address</th><th>Work</th><th>Phone</th><th>Gap</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6">No jobs booked.</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}
