import type {
  FieldAnswerStatus,
  FieldCondition,
  RuleError,
  WorkflowAnswer,
  WorkflowEvidence,
  WorkflowField,
  WorkflowRule,
  WorkflowSignature,
  WorkflowTemplate,
} from "@/lib/domestic-stop-go/types";

export type AnswerMap = Record<string, WorkflowAnswer>;

export function answerLookupKey(fieldKey: string, repeatGroupId?: string | null) {
  return repeatGroupId ? `${fieldKey}::${repeatGroupId}` : fieldKey;
}

export function answersByField(answers: WorkflowAnswer[]): AnswerMap {
  const map: AnswerMap = {};
  for (const answer of answers) {
    map[answerLookupKey(answer.fieldKey, answer.repeatGroupId)] = answer;
  }
  return map;
}

function rawValue(answer?: WorkflowAnswer) {
  if (!answer) return undefined;
  if (answer.answerStatus === "tbc") return undefined;
  return answer.value;
}

function isBlankValue(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return false;
  if (typeof value === "boolean") return false;
  return false;
}

export function conditionMatches(when: FieldCondition | undefined, map: AnswerMap): boolean {
  if (!when) return true;
  const answer = map[when.field];
  const value = rawValue(answer);
  if (when.isEmpty) return isBlankValue(value) && answer?.answerStatus !== "answered";
  if (when.equals !== undefined) return value === when.equals || String(value) === String(when.equals);
  if (when.notEquals !== undefined) return value !== when.notEquals && String(value) !== String(when.notEquals);
  if (when.in) return when.in.some((item) => item === value || String(item) === String(value));
  return Boolean(answer);
}

export function isFieldVisible(field: WorkflowField, rules: WorkflowRule[], map: AnswerMap) {
  if (field.visibleIf && !conditionMatches(field.visibleIf, map)) return false;
  const visibleRule = rules.find((rule) => rule.type === "visible_if" && rule.fieldKey === field.fieldKey);
  if (visibleRule?.when && !conditionMatches(visibleRule.when, map)) return false;
  return true;
}

export function isTbcAtCompletion(answer?: WorkflowAnswer) {
  return answer?.answerStatus === "tbc";
}

function statusReasonMissing(field: WorkflowField, answer?: WorkflowAnswer) {
  if (!answer) return false;
  if (answer.answerStatus === "not_applicable") {
    if (!field.allowNa) return true;
    if ((field.naReasonRequired || field.safetySeverity === "critical") && !String(answer.reason || "").trim()) {
      return true;
    }
  }
  if (answer.answerStatus === "not_tested") {
    if (!field.allowNotTested) return true;
    if ((field.notTestedReasonRequired || true) && !String(answer.reason || "").trim()) return true;
  }
  if (answer.answerStatus === "unable_to_access") {
    if (!field.allowUnable) return true;
    if (!String(answer.reason || "").trim()) return true;
  }
  return false;
}

function hasValue(field: WorkflowField, answer?: WorkflowAnswer, evidence: WorkflowEvidence[] = []) {
  if (!answer) return false;
  if (answer.answerStatus === "not_applicable" && field.allowNa) return !statusReasonMissing(field, answer);
  if (answer.answerStatus === "not_tested" && field.allowNotTested) return !statusReasonMissing(field, answer);
  if (answer.answerStatus === "unable_to_access" && field.allowUnable) return !statusReasonMissing(field, answer);
  if (answer.answerStatus === "tbc") return false;
  if (field.dataType === "photo") {
    return evidence.some((item) => item.fieldKey === field.fieldKey) || Boolean(answer.value);
  }
  if (field.dataType === "boolean") return typeof answer.value === "boolean";
  if (field.dataType === "yes_no" || field.dataType === "choice") return !isBlankValue(answer.value);
  if (field.dataType === "number") return answer.value === 0 || answer.value === "0" || !isBlankValue(answer.value);
  return !isBlankValue(answer.value);
}

function signaturePresent(fieldKey: string, signatures: WorkflowSignature[], map: AnswerMap) {
  const signed = signatures.find((item) => item.status === "signed" && (
    item.role === "engineer" && fieldKey.includes("engineer")
    || item.role !== "engineer" && (fieldKey.includes("customer") || fieldKey.includes("responsible"))
  ));
  if (signed) return true;
  const answer = map[fieldKey];
  return Boolean(answer?.value) || answer?.answerStatus === "answered";
}

export function evaluateRules(options: {
  template: WorkflowTemplate;
  answers: WorkflowAnswer[];
  evidence?: WorkflowEvidence[];
  signatures?: WorkflowSignature[];
  gateKey?: string | null;
  mode: "gate" | "completion";
}): RuleError[] {
  const { template, answers, evidence = [], signatures = [], gateKey, mode } = options;
  const map = answersByField(answers);
  const errors: RuleError[] = [];
  const gate = gateKey ? template.gates.find((item) => item.key === gateKey) : null;
  const gateFieldKeys = gate ? new Set(gate.fieldKeys) : null;

  const inScope = (fieldKey?: string, groupKey?: string) => {
    if (!gateFieldKeys) return true;
    if (fieldKey && gateFieldKeys.has(fieldKey)) return true;
    if (groupKey && template.fields.some((field) => field.groupKey === groupKey && gateFieldKeys.has(field.fieldKey))) {
      return true;
    }
    return false;
  };

  for (const field of template.fields) {
    if (gateFieldKeys && !gateFieldKeys.has(field.fieldKey) && mode === "gate") continue;
    if (!isFieldVisible(field, template.rules, map)) continue;
    const answer = map[field.fieldKey];
    if (mode === "completion" && isTbcAtCompletion(answer)) {
      errors.push({
        fieldKey: field.fieldKey,
        code: "TBC_NOT_ALLOWED",
        severity: "blocking",
        message: `“${field.label}” is still marked TBC. Resolve it before completing the record.`,
        gateKey: gate?.key,
      });
    }
    const required =
      field.requiredRule === "required" ||
      (field.requiredRule === "required_if" && conditionMatches(field.requiredIf, map));
    if (required && !hasValue(field, answer, evidence)) {
      errors.push({
        fieldKey: field.fieldKey,
        code: "REQUIRED_FOR_COMPLETION",
        severity: "blocking",
        message: `Enter ${field.label.toLowerCase()} before continuing.`,
        gateKey: gate?.key,
      });
    }
    if (answer && statusReasonMissing(field, answer)) {
      errors.push({
        fieldKey: field.fieldKey,
        code: "REASON_REQUIRED",
        severity: "blocking",
        message: `Give a reason for ${field.label.toLowerCase()}.`,
        gateKey: gate?.key,
      });
    }
    if (answer?.answerStatus === "unable_to_access") {
      const ack = map[`${field.fieldKey}.customer_ack`] || map["unable.customer_ack"];
      if (mode === "completion" && !hasValue(
        { ...field, fieldKey: "unable.customer_ack", requiredRule: "required" } as WorkflowField,
        ack,
        evidence,
      )) {
        // Handled by explicit fields on the template where present.
      }
    }
    if (field.min != null || field.max != null) {
      const numeric = Number(rawValue(answer));
      if (answer?.answerStatus === "answered" && Number.isFinite(numeric)) {
        if (field.min != null && numeric < field.min) {
          errors.push({
            fieldKey: field.fieldKey,
            code: "RANGE",
            severity: "blocking",
            message: `${field.label} is below the permitted range.`,
          });
        }
        if (field.max != null && numeric > field.max) {
          errors.push({
            fieldKey: field.fieldKey,
            code: "RANGE",
            severity: "blocking",
            message: `${field.label} is above the permitted range.`,
          });
        }
      }
    }
  }

  for (const rule of template.rules) {
    if (!inScope(rule.fieldKey, rule.groupKey) && mode === "gate" && rule.type !== "launch_linked_workflow") {
      if (rule.gateKey && rule.gateKey !== gateKey) continue;
      if (!rule.gateKey) continue;
    }
    const field = template.fields.find((item) => item.fieldKey === rule.fieldKey);
    if (field && !isFieldVisible(field, template.rules, map) && rule.type !== "launch_linked_workflow") {
      continue;
    }
    const answer = rule.fieldKey ? map[rule.fieldKey] : undefined;

    if (rule.type === "required" && rule.fieldKey && field) {
      if (isFieldVisible(field, template.rules, map) && !hasValue(field, answer, evidence)) {
        errors.push({ fieldKey: rule.fieldKey, code: rule.code, severity: rule.severity || "blocking", message: rule.message });
      }
    }
    if (rule.type === "required_if" && rule.fieldKey && field && conditionMatches(rule.when, map)) {
      if (!hasValue(field, answer, evidence)) {
        errors.push({ fieldKey: rule.fieldKey, code: rule.code, severity: rule.severity || "blocking", message: rule.message });
      }
    }
    if (rule.type === "must_equal" && rule.fieldKey && hasValue(field!, answer, evidence)) {
      const value = rawValue(answer);
      if (value !== rule.equals && String(value) !== String(rule.equals)) {
        errors.push({ fieldKey: rule.fieldKey, code: rule.code, severity: rule.severity || "blocking", message: rule.message });
      }
    }
    if (rule.type === "range" && rule.fieldKey && answer?.answerStatus === "answered") {
      const numeric = Number(rawValue(answer));
      if (Number.isFinite(numeric)) {
        if (rule.min != null && numeric < rule.min) {
          errors.push({ fieldKey: rule.fieldKey, code: rule.code, severity: "blocking", message: rule.message });
        }
        if (rule.max != null && numeric > rule.max) {
          errors.push({ fieldKey: rule.fieldKey, code: rule.code, severity: "blocking", message: rule.message });
        }
      }
    }
    if (rule.type === "date_after" && rule.fieldKey && rule.afterField) {
      const later = String(rawValue(map[rule.fieldKey]) || "");
      const earlier = String(rawValue(map[rule.afterField]) || "");
      if (later && earlier && later <= earlier) {
        errors.push({ fieldKey: rule.fieldKey, code: rule.code, severity: "blocking", message: rule.message });
      }
    }
    if (rule.type === "at_least_one_repeat_item" && rule.groupKey) {
      const count = answers.filter(
        (item) => template.fields.find((fieldItem) => fieldItem.fieldKey === item.fieldKey)?.groupKey === rule.groupKey
          && item.repeatGroupId,
      ).length;
      const groupFields = template.fields.filter((item) => item.groupKey === rule.groupKey);
      const groups = new Set(
        answers.filter((item) => groupFields.some((fieldItem) => fieldItem.fieldKey === item.fieldKey)).map((item) => item.repeatGroupId || "default"),
      );
      if (groups.size === 0 && count === 0) {
        errors.push({
          fieldKey: groupFields[0]?.fieldKey || rule.groupKey,
          code: rule.code,
          severity: "blocking",
          message: rule.message,
        });
      }
    }
    if (rule.type === "evidence_required_if" && rule.fieldKey && conditionMatches(rule.when, map)) {
      const found = evidence.some((item) => item.fieldKey === rule.fieldKey);
      const valueOk = Boolean(rawValue(answer));
      if (!found && !valueOk) {
        errors.push({ fieldKey: rule.fieldKey, code: rule.code, severity: "blocking", message: rule.message });
      }
    }
    if (rule.type === "signature_required" && rule.fieldKey) {
      const ok = signaturePresent(rule.fieldKey, signatures, map);
      if (!ok) {
        errors.push({ fieldKey: rule.fieldKey, code: rule.code, severity: "blocking", message: rule.message });
      }
    }
    if (rule.type === "blocks_gate" && conditionMatches(rule.when, map)) {
      errors.push({
        fieldKey: rule.fieldKey || "",
        code: rule.code,
        severity: "blocking",
        message: rule.message,
        gateKey: gate?.key,
      });
    }
    if (rule.type === "launch_linked_workflow" && conditionMatches(rule.when, map)) {
      errors.push({
        fieldKey: rule.fieldKey || "",
        code: rule.code,
        severity: "blocking",
        message: rule.message,
        gateKey: gate?.key,
      });
    }
  }

  const unique = new Map<string, RuleError>();
  for (const error of errors) {
    unique.set(`${error.fieldKey}:${error.code}:${error.message}`, error);
  }
  return Array.from(unique.values());
}

export function distinctStatusesRemainDistinct(values: unknown[]) {
  return new Set(values.map((value) => JSON.stringify(value))).size === values.length;
}

export const KEEP_DISTINCT = [null, "", 0, false, "not_tested", "not_applicable"] as const;
