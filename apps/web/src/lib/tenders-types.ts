import type { TenderDocumentFolder } from "@/lib/tender-document-folders";

export type { TenderDocumentFolder } from "@/lib/tender-document-folders";
export {
  TENDER_DOCUMENT_FOLDER_MAX_DEPTH,
  TENDER_DOCUMENT_KINDS,
  isTenderDocumentKind,
  normalizeTenderDocumentFolders,
  resolveTenderDocumentFolderKind,
  tenderDocumentFolderDepth,
  tenderDocumentFolderPathLabel,
} from "@/lib/tender-document-folders";

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
  /** Optional custom folder; files without this sit in the built-in kind bucket. */
  folderId?: string;
};

export type TenderBoqLineKind = "header" | "measured" | "note";

/** Where a BoQ unit rate came from — budget/guide are planning figures, not firm quotes. */
export type TenderBoqPricingSource = "blake-budget" | "rate-library" | "manual";

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
  /** blake-budget / rate-library = guide; manual = office/typed. */
  pricingSource?: TenderBoqPricingSource;
  /**
   * Excel worksheet / BoQ sheet-tab id (trimmed workbook tab name).
   * Stable across save → reload → navigate away → reopen. Drives the tab bar.
   * Distinct from `section`, which is a bill heading inside a sheet.
   */
  sheet?: string;
  /**
   * Bill section / heading inside a sheet (or legacy single-page section label).
   * Header rows usually repeat the section title here too.
   */
  section?: string;
  /** @deprecated Unpriced lines stay on the BoQ with blank rates — do not use. */
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
  clientId?: string;
  linkedTakeoffId?: string;
  linkedTakeoffRef?: string;
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
  /** Office-created folders/subfolders for drawings, specs, etc. Built-in kinds always remain. */
  documentFolders?: TenderDocumentFolder[];
  submittedAt?: string;
  convertedJobId?: string;
  convertedJobRef?: string;
  createdAt: string;
  updatedAt: string;
};

export function computeBoqTotal(lines: TenderBoqLine[]) {
  return Math.round(
    lines.reduce((sum, line) => {
      if (line.kind !== "measured") return sum;
      // Blank rate AND blank value = not priced (still shown on the BoQ; not free / NIL).
      const hasRate = typeof line.rate === "number" && Number.isFinite(line.rate);
      const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
      if (!hasRate && !hasValue) return sum;
      const value = hasValue
        ? line.value!
        : typeof line.quantity === "number" && Number.isFinite(line.quantity)
          ? line.rate! * line.quantity
          : line.rate!;
      return sum + value;
    }, 0) * 100,
  ) / 100;
}

export function boqProgress(lines: TenderBoqLine[]) {
  const measured = lines.filter((line) => line.kind === "measured");
  const priced = measured.filter((line) => {
    const hasRate = typeof line.rate === "number" && Number.isFinite(line.rate);
    const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
    return hasRate || hasValue;
  });
  return {
    measured: measured.length,
    priced: priced.length,
    unpriced: measured.length - priced.length,
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
