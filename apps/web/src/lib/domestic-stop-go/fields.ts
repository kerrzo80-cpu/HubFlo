import type {
  FieldCondition,
  SafetySeverity,
  WorkflowField,
  WorkflowGate,
  WorkflowRule,
} from "@/lib/domestic-stop-go/types";

let pdfOrder = 0;
export function resetPdfOrder(start = 0) {
  pdfOrder = start;
}

function nextOrder() {
  pdfOrder += 10;
  return pdfOrder;
}

export function opts(values: string[]) {
  return values.map((value) => ({ value, label: value.replace(/_/g, " ") }));
}

export function labelledOpts(pairs: Array<[string, string]>) {
  return pairs.map(([value, label]) => ({ value, label }));
}

type FieldInput = Partial<WorkflowField> & Pick<WorkflowField, "fieldKey" | "label" | "dataType" | "pdfSection">;

export function field(input: FieldInput): WorkflowField {
  return {
    requiredRule: input.requiredRule ?? (input.requiredIf ? "required_if" : "required"),
    pdfOrder: input.pdfOrder ?? nextOrder(),
    ...input,
  };
}

export function text(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({ fieldKey, label, dataType: "text", pdfSection, inputKind: extra.inputKind ?? "text", ...extra });
}

export function area(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({ fieldKey, label, dataType: "textarea", pdfSection, inputKind: "textarea", ...extra });
}

export function num(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({
    fieldKey,
    label,
    dataType: "number",
    pdfSection,
    inputKind: extra.inputKind ?? "decimal",
    ...extra,
  });
}

export function yesNo(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({
    fieldKey,
    label,
    dataType: "yes_no",
    pdfSection,
    options: labelledOpts([
      ["yes", "Yes"],
      ["no", "No"],
    ]),
    ...extra,
  });
}

export function choice(
  fieldKey: string,
  label: string,
  pdfSection: string,
  options: WorkflowField["options"],
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({ fieldKey, label, dataType: "choice", pdfSection, options, ...extra });
}

export function dateField(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({ fieldKey, label, dataType: "date", pdfSection, inputKind: "date", ...extra });
}

export function timeField(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({ fieldKey, label, dataType: "time", pdfSection, inputKind: "time", ...extra });
}

export function photo(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({ fieldKey, label, dataType: "photo", pdfSection, evidenceRequired: extra.evidenceRequired ?? true, ...extra });
}

export function signatureField(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return field({ fieldKey, label, dataType: "signature", pdfSection, inputKind: "signature", ...extra });
}

export function yn3(
  fieldKey: string,
  label: string,
  pdfSection: string,
  extra: Partial<WorkflowField> = {},
): WorkflowField {
  return choice(
    fieldKey,
    label,
    pdfSection,
    labelledOpts([
      ["yes", "Yes"],
      ["no", "No"],
      ["na", "N/A"],
    ]),
    { allowNa: true, ...extra },
  );
}

export function gate(key: string, label: string, fieldKeys: string[], extra?: Partial<WorkflowGate>): WorkflowGate {
  return { key, label, summary: extra?.summary || label, fieldKeys, ...extra };
}

export function requiredRule(fieldKey: string, message: string): WorkflowRule {
  return {
    type: "required",
    fieldKey,
    message,
    code: "REQUIRED_FOR_COMPLETION",
    severity: "blocking",
  };
}

export function requiredIf(fieldKey: string, when: FieldCondition, message: string): WorkflowRule {
  return {
    type: "required_if",
    fieldKey,
    when,
    message,
    code: "REQUIRED_IF",
    severity: "blocking",
  };
}

export function visibleIf(fieldKey: string, when: FieldCondition): WorkflowRule {
  return {
    type: "visible_if",
    fieldKey,
    when,
    message: "",
    code: "VISIBLE_IF",
  };
}

export function mustEqual(fieldKey: string, equals: unknown, message: string, extra: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    type: "must_equal",
    fieldKey,
    equals,
    message,
    code: extra.code || "MUST_EQUAL",
    severity: extra.severity || "blocking",
    hardStop: extra.hardStop,
    ...extra,
  };
}

export function blocksWhen(fieldKey: string, when: FieldCondition, message: string, extra: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    type: "blocks_gate",
    fieldKey,
    when,
    message,
    code: extra.code || "BLOCKS_GATE",
    severity: "blocking",
    hardStop: true,
    ...extra,
  };
}

export function launchUnsafeWhen(
  fieldKey: string,
  when: FieldCondition,
  targetCostCentreCode: string,
  message: string,
): WorkflowRule {
  return {
    type: "launch_linked_workflow",
    fieldKey,
    when,
    targetCostCentreCode,
    message,
    code: "LAUNCH_LINKED_WORKFLOW",
    severity: "blocking",
    hardStop: true,
  };
}

export function sigRule(fieldKey: string, message: string): WorkflowRule {
  return {
    type: "signature_required",
    fieldKey,
    message,
    code: "SIGNATURE_REQUIRED",
    severity: "blocking",
  };
}

export function atLeastOne(groupKey: string, message: string): WorkflowRule {
  return {
    type: "at_least_one_repeat_item",
    groupKey,
    message,
    code: "AT_LEAST_ONE_REPEAT_ITEM",
    severity: "blocking",
  };
}

export function dateAfter(fieldKey: string, afterField: string, message: string): WorkflowRule {
  return {
    type: "date_after",
    fieldKey,
    afterField,
    message,
    code: "DATE_AFTER",
    severity: "blocking",
  };
}

export function evidenceIf(fieldKey: string, when: FieldCondition, message: string): WorkflowRule {
  return {
    type: "evidence_required_if",
    fieldKey,
    when,
    message,
    code: "EVIDENCE_REQUIRED_IF",
    severity: "blocking",
  };
}

export function critical(safetySeverity: SafetySeverity = "critical"): Pick<WorkflowField, "safetySeverity"> {
  return { safetySeverity };
}
