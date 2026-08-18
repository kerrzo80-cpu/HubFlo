import type { HubDetailState } from "@/lib/hub-detail-store";
import {
  summarizeDayworkSheetForPoll,
  summarizeDayworkSheetsMapForPoll,
  type DayworkAccountRecord,
} from "@/lib/daywork-account-form";

const SIGNATURE_EVIDENCE_SUFFIXES = [":daywork-plumber-sign", ":daywork-client-sign"];

function isHeavyDataUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("data:image/") && value.length > 200;
}

function stripDeliveryEventBlobs(events: unknown): unknown {
  if (!Array.isArray(events)) return events;
  return events.map((event) => {
    if (!event || typeof event !== "object") return event;
    const row = event as Record<string, unknown>;
    const next = { ...row };
    if ("plumberSignature" in next) {
      next.hasSignatures = Boolean(
        String(row.plumberSignature || "").trim() && String(row.clientSignature || "").trim(),
      );
      next.plumberSignature = "";
      next.clientSignature = "";
    }
    return next;
  });
}

function stripFlowStepEvidenceBlobs(evidence: unknown): unknown {
  if (!evidence || typeof evidence !== "object") return evidence;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(evidence as Record<string, unknown>)) {
    const isSignatureStep = SIGNATURE_EVIDENCE_SUFFIXES.some((suffix) => key.endsWith(suffix));
    if (!value || typeof value !== "object") {
      next[key] = value;
      continue;
    }
    const row = value as Record<string, unknown>;
    if (isSignatureStep || isHeavyDataUrl(row.text) || isHeavyDataUrl(row.dataUrl)) {
      next[key] = {
        ...row,
        text: row.text && isHeavyDataUrl(row.text) ? "[signature on file]" : row.text,
        dataUrl: undefined,
        hasSignature: true,
      };
      continue;
    }
    next[key] = row;
  }
  return next;
}

/** Strip base64 signatures from hub-state poll responses. PDF export still reads full sheets from disk. */
export function stripDayworkBlobsForPoll(state: HubDetailState): HubDetailState {
  const sheets = summarizeDayworkSheetsMapForPoll(
    (state.dayworkSheets || {}) as Record<string, DayworkAccountRecord>,
  );
  return {
    ...state,
    dayworkSheets: sheets as HubDetailState["dayworkSheets"],
    jobDeliveryEvents: stripDeliveryEventBlobs(state.jobDeliveryEvents) as HubDetailState["jobDeliveryEvents"],
    flowStepEvidence: stripFlowStepEvidenceBlobs(state.flowStepEvidence) as HubDetailState["flowStepEvidence"],
  };
}

export function summarizeDayworkApiPayload(args: {
  record: DayworkAccountRecord | null;
  sheet: DayworkAccountRecord | null;
  dayworkSheets?: Record<string, DayworkAccountRecord>;
  flowStepEvidence?: unknown;
  jobDeliveryEvents?: unknown;
}) {
  return {
    record: args.record ? summarizeDayworkSheetForPoll(args.record) : null,
    sheet: args.sheet ? summarizeDayworkSheetForPoll(args.sheet) : null,
    dayworkSheets: summarizeDayworkSheetsMapForPoll(args.dayworkSheets),
    flowStepEvidence: stripFlowStepEvidenceBlobs(args.flowStepEvidence),
    jobDeliveryEvents: stripDeliveryEventBlobs(args.jobDeliveryEvents),
  };
}
