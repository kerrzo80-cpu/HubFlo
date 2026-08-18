/**
 * AI Takeoff Assistant — tender-scoped chat + structured proposals.
 * AI proposes quantities; NeXa calculates money and validates.
 */

export type AiTakeoffLineStatus = "proposed" | "accepted" | "rejected" | "applied";
export type AiTakeoffLineKind = "header" | "measured" | "note" | "labour";
export type AiTakeoffPhase = "1st fix" | "2nd fix" | "commissioning" | "return visit" | "general";

export type AiTakeoffMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: string }>;
  openaiResponseId?: string;
};

export type AiTakeoffUploadedFile = {
  id: string;
  tenderDocumentId?: string;
  name: string;
  kind: string;
  mimeType?: string;
  url?: string;
  uploadedAt: string;
  notes?: string;
};

export type AiTakeoffLine = {
  id: string;
  revisionId: string;
  status: AiTakeoffLineStatus;
  kind: AiTakeoffLineKind;
  houseType?: string;
  plotNumber?: string;
  costCentre?: string;
  phase?: AiTakeoffPhase;
  ref?: string;
  description: string;
  quantity: number;
  unit: string;
  /** AI/proposed unit cost — NeXa calc uses this after validation */
  unitCost: number;
  markupPercent: number;
  labourHours: number;
  labourRate: number;
  sourceDocument?: string;
  assumptionIds?: string[];
  confidence?: "High" | "Medium" | "Low";
  appliedBoqLineId?: string;
  updatedAt: string;
};

export type AiTakeoffAssumption = {
  id: string;
  revisionId: string;
  kind: "assumption" | "exclusion" | "query";
  text: string;
  status: "open" | "accepted" | "rejected";
  createdAt: string;
};

export type AiTakeoffPricingRules = {
  labourRatePerHour: number;
  dayworkRatePerHour: number;
  materialsMarkupPercent: number;
  sanitarywareMarkupPercent: number;
  labourRoundToHours: number;
  sprinklersByOthers: boolean;
  neverHideProvisionals: boolean;
  pipeworkUnit: "m";
};

export type AiTakeoffRevision = {
  id: string;
  label: string;
  parentRevisionId?: string;
  createdAt: string;
  createdBy?: string;
  summary?: string;
  approvedAt?: string;
};

export type TenderAiTakeoffState = {
  tenderId: string;
  linkedTakeoffId?: string;
  openaiConversationId?: string;
  activeRevisionId: string;
  messages: AiTakeoffMessage[];
  files: AiTakeoffUploadedFile[];
  lines: AiTakeoffLine[];
  assumptions: AiTakeoffAssumption[];
  pricingRules: AiTakeoffPricingRules;
  revisions: AiTakeoffRevision[];
  houseTypes: string[];
  plots: Array<{ plot: string; houseType: string }>;
  updatedAt: string;
};

export const DEFAULT_AI_TAKEOFF_PRICING_RULES: AiTakeoffPricingRules = {
  labourRatePerHour: 70,
  dayworkRatePerHour: 60,
  materialsMarkupPercent: 30,
  sanitarywareMarkupPercent: 20,
  labourRoundToHours: 0.5,
  sprinklersByOthers: true,
  neverHideProvisionals: true,
  pipeworkUnit: "m",
};

export type CalculatedTakeoffLine = AiTakeoffLine & {
  materialSell: number;
  labourCost: number;
  labourSell: number;
  lineTotalCost: number;
  lineTotalSell: number;
};
