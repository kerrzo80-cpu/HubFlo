export interface CompletionCount {
  complete: number;
  total: number;
}

export interface InvoiceReadinessInput {
  requiredTasks: CompletionCount;
  openBlockers: number;
  unresolvedVariations: number;
  completionNoteSubmitted: boolean;
  requiredPhotos: CompletionCount;
  requiredDocuments: CompletionCount;
  timesheetsSubmitted: boolean;
  materialCostsConfirmed: boolean;
  finalJobValueConfirmed: boolean;
}

export interface InvoiceBlockReason {
  code:
    | "TASKS_INCOMPLETE"
    | "OPEN_BLOCKERS"
    | "UNRESOLVED_VARIATIONS"
    | "COMPLETION_NOTE_MISSING"
    | "PHOTOS_MISSING"
    | "DOCUMENTS_MISSING"
    | "TIMESHEETS_MISSING"
    | "MATERIAL_COSTS_UNCONFIRMED"
    | "FINAL_VALUE_UNCONFIRMED";
  title: string;
  detail: string;
}

export interface InvoiceReadinessResult {
  ready: boolean;
  completedChecks: number;
  totalChecks: number;
  reasons: InvoiceBlockReason[];
}

export function checkInvoiceReadiness(
  input: InvoiceReadinessInput,
): InvoiceReadinessResult {
  const reasons: InvoiceBlockReason[] = [];

  if (input.requiredTasks.complete < input.requiredTasks.total) {
    reasons.push({
      code: "TASKS_INCOMPLETE",
      title: "Required tasks incomplete",
      detail: `${input.requiredTasks.total - input.requiredTasks.complete} required task remaining.`,
    });
  }

  if (input.openBlockers > 0) {
    reasons.push({
      code: "OPEN_BLOCKERS",
      title: "Open blocker",
      detail: `${input.openBlockers} blocker must be resolved before invoicing.`,
    });
  }

  if (input.unresolvedVariations > 0) {
    reasons.push({
      code: "UNRESOLVED_VARIATIONS",
      title: "Variation needs review",
      detail: `${input.unresolvedVariations} variation has not completed its commercial workflow.`,
    });
  }

  if (!input.completionNoteSubmitted) {
    reasons.push({
      code: "COMPLETION_NOTE_MISSING",
      title: "Completion note missing",
      detail: "The assigned engineer must submit a completion note.",
    });
  }

  if (input.requiredPhotos.complete < input.requiredPhotos.total) {
    reasons.push({
      code: "PHOTOS_MISSING",
      title: "Required photos missing",
      detail: `${input.requiredPhotos.total - input.requiredPhotos.complete} required photo remaining.`,
    });
  }

  if (input.requiredDocuments.complete < input.requiredDocuments.total) {
    reasons.push({
      code: "DOCUMENTS_MISSING",
      title: "Required documents missing",
      detail: `${input.requiredDocuments.total - input.requiredDocuments.complete} required document remaining.`,
    });
  }

  if (!input.timesheetsSubmitted) {
    reasons.push({
      code: "TIMESHEETS_MISSING",
      title: "Timesheets missing",
      detail: "All labour entries must be submitted before invoicing.",
    });
  }

  if (!input.materialCostsConfirmed) {
    reasons.push({
      code: "MATERIAL_COSTS_UNCONFIRMED",
      title: "Material costs unconfirmed",
      detail: "Confirm posted and outstanding material costs.",
    });
  }

  if (!input.finalJobValueConfirmed) {
    reasons.push({
      code: "FINAL_VALUE_UNCONFIRMED",
      title: "Final job value unconfirmed",
      detail: "Finance must confirm the final chargeable job value.",
    });
  }

  const totalChecks = 9;

  return {
    ready: reasons.length === 0,
    completedChecks: totalChecks - reasons.length,
    totalChecks,
    reasons,
  };
}

