export type TimelineStage = "lead" | "quote" | "job" | "invoice";

export type TimelineEntryKind =
  | "communication"
  | "audit"
  | "schedule"
  | "delivery"
  | "system";

export type TimelineEntry = {
  id: string;
  kind: TimelineEntryKind;
  stage: TimelineStage;
  stageRef: string;
  title: string;
  detail: string;
  actor: string;
  at: string;
  sortKey: string;
  channel?: "Outlook" | "Client portal" | "WhatsApp" | string;
  direction?: "outbound" | "inbound" | string;
  tone?: "blue" | "green" | "amber" | "red" | "neutral";
};

const monthIndex: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Best-effort sort key for en-GB display timestamps like "04 Aug 2026 14:30". */
export function timelineSortKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "0000-00-00T00:00:00";

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed;
  }

  const match = trimmed.match(
    /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  if (match) {
    const day = (match[1] ?? "01").padStart(2, "0");
    const monthToken = (match[2] ?? "").toLowerCase();
    const month = monthIndex[monthToken];
    const year = match[3] ?? "1970";
    const hour = (match[4] ?? "00").padStart(2, "0");
    const minute = match[5] ?? "00";
    if (month !== undefined) {
      return `${year}-${String(month + 1).padStart(2, "0")}-${day}T${hour}:${minute}:00`;
    }
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return trimmed;
}

export function sortTimelineEntries(entries: TimelineEntry[]) {
  return [...entries].sort((a, b) => {
    const byTime = b.sortKey.localeCompare(a.sortKey);
    if (byTime !== 0) return byTime;
    return b.id.localeCompare(a.id);
  });
}

export function makeTimelineEntry(
  input: Omit<TimelineEntry, "sortKey"> & { sortKey?: string },
): TimelineEntry {
  return {
    ...input,
    sortKey: input.sortKey ?? timelineSortKey(input.at),
  };
}
