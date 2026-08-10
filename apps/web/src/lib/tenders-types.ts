export const TENDER_STATUSES = [
  "Not Started",
  "In Progress",
  "Needs Reviewed",
  "Sent",
  "Won",
  "Lost",
] as const;

export type TenderStatus = (typeof TENDER_STATUSES)[number];

export const TENDER_CATEGORIES = [
  "Electrical",
  "Plumbing",
  "Joinery",
  "Painting & Decorating",
  "Groundworks",
  "Roofing",
  "Plastering",
  "Heating",
  "Carpentry",
  "Bricklaying",
] as const;

export const TENDER_AREAS = [
  "Aberdeen",
  "Aberdeenshire",
  "Angus",
  "Dundee",
  "Moray",
  "Highlands",
  "Perthshire",
] as const;

export type TenderDocumentKind =
  | "issued-boq"
  | "priced-boq"
  | "form-of-tender"
  | "drawing"
  | "specification"
  | "supplier-quote"
  | "other";

export type TenderDocument = {
  id: string;
  kind: TenderDocumentKind;
  name: string;
  mimeType?: string;
  url?: string;
  uploadedAt: string;
  note?: string;
};

export type TenderBoqLineKind = "header" | "measured" | "note";

export type TenderBoqLine = {
  id: string;
  kind: TenderBoqLineKind;
  ref?: string;
  description: string;
  quantity?: number | null;
  unit?: string;
  rate?: number | null;
  value?: number | null;
  note?: string;
  excluded?: boolean;
};

export type TenderDayworkRates = {
  labourPerHour: number;
  materialsUpliftPercent: number;
  plantUpliftPercent: number;
};

export type Tender = {
  id: string;
  externalId?: string;
  name: string;
  client: string;
  category: string;
  area: string;
  submissionDeadline?: string;
  status: TenderStatus;
  owner: string;
  bidValue: number;
  tenderSum?: number;
  winProbability?: number;
  materialsNote?: string;
  qualifications: string[];
  daywork: TenderDayworkRates;
  boqTitle?: string;
  boqLines: TenderBoqLine[];
  documents: TenderDocument[];
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export function computeBoqTotal(lines: TenderBoqLine[]) {
  return Math.round(
    lines.reduce((sum, line) => {
      if (line.kind !== "measured" || line.excluded) return sum;
      const value =
        typeof line.value === "number" && Number.isFinite(line.value)
          ? line.value
          : typeof line.rate === "number" &&
              typeof line.quantity === "number" &&
              Number.isFinite(line.rate) &&
              Number.isFinite(line.quantity)
            ? line.rate * line.quantity
            : 0;
      return sum + value;
    }, 0) * 100,
  ) / 100;
}

export function boqProgress(lines: TenderBoqLine[]) {
  const measured = lines.filter((line) => line.kind === "measured");
  const priced = measured.filter(
    (line) =>
      !line.excluded &&
      ((typeof line.rate === "number" && Number.isFinite(line.rate)) ||
        (typeof line.value === "number" && Number.isFinite(line.value))),
  );
  const excluded = measured.filter((line) => line.excluded);
  return {
    measured: measured.length,
    priced: priced.length,
    excluded: excluded.length,
    unpriced: measured.length - priced.length - excluded.length,
  };
}

export function daysLeftForDeadline(deadline?: string, asOf = new Date().toISOString().slice(0, 10)) {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}/.test(deadline)) return null;
  const start = Date.parse(`${deadline.slice(0, 10)}T12:00:00`);
  const current = Date.parse(`${asOf.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(current)) return null;
  return Math.floor((start - current) / 86_400_000);
}

export function alertForDeadline(deadline?: string, asOf?: string) {
  const days = daysLeftForDeadline(deadline, asOf);
  if (days === null) return "";
  if (days < 0) return "Overdue";
  if (days <= 7) return "Due this week";
  if (days <= 30) return "Upcoming";
  return "OK";
}
