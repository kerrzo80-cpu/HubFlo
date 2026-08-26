import {
  area,
  choice,
  dateField,
  field,
  labelledOpts,
  launchUnsafeWhen,
  mustEqual,
  num,
  photo,
  requiredIf,
  signatureField,
  text,
  timeField,
  yn3,
  yesNo,
} from "@/lib/domestic-stop-go/fields";
import type { WorkflowField, WorkflowRule } from "@/lib/domestic-stop-go/types";

const A = "Attendance";
const B = "Safe start";
const C = "Evidence";
const D = "Review & declaration";

export function attendanceFields(fuel: "gas" | "oil"): WorkflowField[] {
  return [
    text("attendance.job_number", "Job number", A, { systemPopulated: true }),
    text("attendance.appointment_id", "Appointment ID", A, { systemPopulated: true }),
    text("attendance.property_address", "Property address", A, { systemPopulated: true }),
    text("attendance.postcode", "Postcode", A, { systemPopulated: true }),
    yesNo("attendance.address_confirmed", "Property address confirmed", A),
    yesNo("attendance.domestic_confirmed", "This is a domestic property", A, { safetySeverity: "critical" }),
    dateField("attendance.attendance_date", "Attendance date (actual)", A, {
      helpText: "Defaults to the scheduled diary slot. Change if you attended on a different day.",
    }),
    timeField("attendance.arrival_time", "Arrival time (actual)", A, {
      helpText: "Defaults to the scheduled start. Change if you arrived later.",
    }),
    text("attendance.engineer_user_id", "Engineer user ID", A, { systemPopulated: true }),
    text("attendance.customer_name", "Customer / landlord / agent name", A),
    text("attendance.customer_contact", "Customer contact details", A),
    text("attendance.person_present", "Person present", A),
    text("attendance.person_relationship", "Relationship to property", A, { placeholder: "e.g. occupier, landlord, agent" }),
    area("attendance.work_requested", "Work requested / reported fault", A),
    ...(fuel === "gas"
      ? [
          text("attendance.gas_safe_number", "Engineer Gas Safe registration number", A, {
            pattern: "^\\d{12}$",
            inputKind: "digits" as const,
            helpText: "12-digit Gas Safe ID.",
            placeholder: "12-digit Gas Safe ID",
          }),
          text("attendance.engineer_id", "Engineer ID", A, { systemPopulated: true }),
        ]
      : [
          text("attendance.oftec_registration", "OFTEC / business registration", A, { requiredRule: "optional" as const }),
          text("attendance.technician_details", "Technician details", A),
        ]),
    yesNo("attendance.competency_confirmed", "Engineer competency confirmed for this fuel / appliance", A, {
      safetySeverity: "critical",
      systemPopulated: true,
    }),
  ];
}

export function attendanceRules(fuel: "gas" | "oil"): WorkflowRule[] {
  return [
    mustEqual("attendance.domestic_confirmed", "yes", "This workflow is for domestic properties only.", { hardStop: true }),
    mustEqual("attendance.address_confirmed", "yes", "Confirm the property address before starting."),
    mustEqual("attendance.competency_confirmed", "yes", "Engineer competency is not valid for this work.", {
      hardStop: true,
      code: "COMPETENCY_INVALID",
    }),
    ...(fuel === "gas"
      ? [
          {
            type: "required" as const,
            fieldKey: "attendance.gas_safe_number",
            message: "Enter the engineer Gas Safe registration number.",
            code: "REQUIRED_FOR_COMPLETION",
            severity: "blocking" as const,
          },
        ]
      : []),
  ];
}

export function safeStartFields(fuel: "gas" | "oil"): WorkflowField[] {
  const unsafeTarget = fuel === "gas" ? "DOM_GAS_UNSAFE" : undefined;
  return [
    yesNo("safe_start.visual_risk_complete", "Visual risk assessment complete", B, { safetySeverity: "critical" }),
    yesNo("safe_start.safe_access", "Safe access and working area confirmed", B, { safetySeverity: "critical" }),
    choice(
      "safe_start.fuel_type",
      "Fuel type confirmed",
      B,
      fuel === "gas"
        ? labelledOpts([
            ["natural_gas", "Natural gas"],
            ["lpg", "LPG"],
          ])
        : labelledOpts([
            ["kerosene", "Kerosene"],
            ["hvo", "HVO"],
            ["other", "Other permitted fuel"],
          ]),
    ),
    text("safe_start.appliance_location", "Appliance location", B),
    yesNo("safe_start.hazard_signs", "Signs / smell of gas, oil leak, fumes, scorching or spillage?", B, {
      safetySeverity: "critical",
    }),
    area("safe_start.hazard_signs_detail", "Hazard details", B, {
      requiredRule: "required_if",
      requiredIf: { field: "safe_start.hazard_signs", equals: "yes" },
      visibleIf: { field: "safe_start.hazard_signs", equals: "yes" },
      safetySeverity: "critical",
    }),
    yesNo("safe_start.co_alarm_present", "Existing CO alarm present?", B),
    text("safe_start.co_alarm_location", "CO alarm location", B, {
      requiredRule: "required_if",
      requiredIf: { field: "safe_start.co_alarm_present", equals: "yes" },
      visibleIf: { field: "safe_start.co_alarm_present", equals: "yes" },
    }),
    choice(
      "safe_start.co_alarm_test",
      "CO alarm test result",
      B,
      labelledOpts([
        ["pass", "Pass"],
        ["fail", "Fail"],
        ["not_tested", "Not tested"],
      ]),
      {
        requiredRule: "required_if",
        requiredIf: { field: "safe_start.co_alarm_present", equals: "yes" },
        visibleIf: { field: "safe_start.co_alarm_present", equals: "yes" },
        allowNotTested: true,
        notTestedReasonRequired: true,
      },
    ),
    photo("safe_start.co_alarm_photo", "CO alarm photo", B, {
      requiredRule: "required_if",
      requiredIf: { field: "safe_start.co_alarm_present", equals: "yes" },
      visibleIf: { field: "safe_start.co_alarm_present", equals: "yes" },
    }),
    yesNo("safe_start.existing_defects", "Existing visible defects?", B),
    area("safe_start.existing_defects_notes", "Existing defect notes", B, {
      requiredRule: "required_if",
      requiredIf: { field: "safe_start.existing_defects", equals: "yes" },
      visibleIf: { field: "safe_start.existing_defects", equals: "yes" },
    }),
    photo("safe_start.existing_defects_photo", "Existing defect photo", B, {
      requiredRule: "optional",
      visibleIf: { field: "safe_start.existing_defects", equals: "yes" },
    }),
    yesNo("safe_start.customer_advised_unsafe", "Customer advised before disturbing an apparently unsafe installation", B, {
      requiredRule: "required_if",
      requiredIf: { field: "safe_start.hazard_signs", equals: "yes" },
      visibleIf: { field: "safe_start.hazard_signs", equals: "yes" },
      safetySeverity: "critical",
    }),
    yesNo(
      "safe_start.immediate_danger",
      fuel === "gas"
        ? "Suspected gas escape, products of combustion, unsafe flue or other immediate danger?"
        : "Dangerous oil leak, fire risk, pollution risk or other immediate danger?",
      B,
      { safetySeverity: "critical" },
    ),
    field({
      fieldKey: "safe_start.unsafe_target",
      label: "Linked warning workflow",
      dataType: "text",
      pdfSection: B,
      requiredRule: "optional",
      systemPopulated: true,
      helpText: unsafeTarget,
    }),
  ];
}

export function safeStartRules(fuel: "gas" | "oil"): WorkflowRule[] {
  const target = fuel === "gas" ? "DOM_GAS_UNSAFE" : "DOM_OIL_SERVICE_TANK";
  return [
    mustEqual("safe_start.visual_risk_complete", "yes", "Complete the visual risk assessment before continuing.", {
      hardStop: true,
    }),
    mustEqual("safe_start.safe_access", "yes", "Confirm safe access before continuing.", { hardStop: true }),
    launchUnsafeWhen(
      "safe_start.immediate_danger",
      { field: "safe_start.immediate_danger", equals: "yes" },
      target,
      fuel === "gas"
        ? "Immediate danger recorded. Complete the Gas Warning / Unsafe Situation Record before routine work can continue."
        : "Immediate oil / fire / pollution danger recorded. Complete the warning and make-safe section before routine work can continue.",
    ),
    requiredIf("safe_start.hazard_signs_detail", { field: "safe_start.hazard_signs", equals: "yes" }, "Describe the hazard signs observed."),
  ];
}

export function evidenceFields(keys: Array<{ key: string; label: string; required?: boolean }>): WorkflowField[] {
  return keys.map((item) =>
    photo(item.key, item.label, C, { requiredRule: item.required === false ? "optional" : "required" }),
  );
}

export function reviewFields(options: { handover?: boolean; nextDue?: boolean }): WorkflowField[] {
  return [
    choice(
      "review.work_outcome",
      "Work outcome",
      D,
      labelledOpts([
        ["completed", "Completed"],
        ["partial", "Partial / return required"],
        ["unsafe", "Unsafe / made safe"],
        ["quote_required", "Quotation required"],
      ]),
    ),
    area("review.outstanding_defects", "Outstanding defects / recommendations", D),
    choice(
      "review.defect_severity",
      "Outstanding item severity",
      D,
      labelledOpts([
        ["none", "None"],
        ["advisory", "Advisory"],
        ["urgent", "Urgent"],
        ["unsafe", "Unsafe"],
      ]),
      { requiredRule: "required_if", requiredIf: { field: "review.outstanding_defects", notEquals: "" } },
    ),
    yesNo("review.remedial_quote_required", "Remedial quotation required?", D),
    ...(options.nextDue ? [dateField("review.next_due_date", "Next service / safety-check due date", D)] : []),
    ...(options.handover
      ? [
          yesNo("review.docs_handed_over", "Documents / operating instructions handed over", D),
        ]
      : []),
    text("review.engineer_name", "Engineer name", D, { systemPopulated: true }),
    text("review.engineer_ids", "Engineer IDs / registration", D, { systemPopulated: true }),
    text("review.completion_timestamp", "Completion timestamp", D, { systemPopulated: true }),
    text("review.device_audit", "App / device audit metadata", D, { systemPopulated: true, requiredRule: "optional" }),
    signatureField("review.engineer_signature", "Engineer declaration and signature", D, { safetySeverity: "critical" }),
    text("review.customer_name", "Customer / responsible-person name", D),
    choice(
      "review.customer_sign_status",
      "Customer / responsible-person acknowledgement",
      D,
      labelledOpts([
        ["signed", "Signed"],
        ["refused_to_sign", "Refused to sign"],
        ["not_present", "Not present"],
      ]),
      { invalidatesDownstream: true },
    ),
    signatureField("review.customer_signature", "Customer / responsible-person signature", D, {
      requiredRule: "required_if",
      requiredIf: { field: "review.customer_sign_status", equals: "signed" },
      visibleIf: { field: "review.customer_sign_status", equals: "signed" },
    }),
    area("review.customer_sign_reason", "Refusal / not present reason", D, {
      requiredRule: "required_if",
      requiredIf: { field: "review.customer_sign_status", in: ["refused_to_sign", "not_present"] },
      visibleIf: { field: "review.customer_sign_status", in: ["refused_to_sign", "not_present"] },
    }),
    area("review.engineer_declaration", "Engineer declaration", D, {
      helpText: "Signatures acknowledge receipt/information only. They do not waive statutory rights or engineer safety duties.",
    }),
  ];
}

export function reviewRules(): WorkflowRule[] {
  return [
    {
      type: "signature_required",
      fieldKey: "review.engineer_signature",
      message: "Engineer signature is required.",
      code: "SIGNATURE_REQUIRED",
      severity: "blocking",
    },
    requiredIf(
      "review.customer_sign_reason",
      { field: "review.customer_sign_status", in: ["refused_to_sign", "not_present"] },
      "Record why the customer did not sign. Silent bypass is not allowed.",
    ),
    requiredIf(
      "review.customer_signature",
      { field: "review.customer_sign_status", equals: "signed" },
      "Capture the customer or responsible-person signature.",
    ),
  ];
}

export function combustionReadingFields(prefix: string, section: string, extra: Partial<WorkflowField> = {}): WorkflowField[] {
  return [
    text(`${prefix}.analyser_make`, "Analyser make / model", section, extra),
    text(`${prefix}.analyser_serial`, "Analyser serial number", section, extra),
    dateField(`${prefix}.calibration_due`, "Analyser calibration due date", section, extra),
    text(`${prefix}.test_point`, "Test point", section, extra),
    text(`${prefix}.operating_mode`, "Boiler operating mode / load", section, extra),
    num(`${prefix}.o2`, "O₂", section, { unit: "%", ...extra }),
    num(`${prefix}.co2`, "CO₂", section, { unit: "%", ...extra }),
    num(`${prefix}.co_ppm`, "CO", section, { unit: "ppm", ...extra }),
    num(`${prefix}.co_co2_ratio`, "CO/CO₂ ratio", section, extra),
    num(`${prefix}.flue_temp`, "Flue-gas temperature", section, { unit: "°C", ...extra }),
    num(`${prefix}.ambient_temp`, "Ambient temperature", section, { unit: "°C", ...extra }),
    num(`${prefix}.efficiency`, "Calculated efficiency", section, { unit: "%", requiredRule: "optional", ...extra }),
  ];
}

export const CONTRACTOR_DISCLAIMER =
  "This is the contractor's digital work record, produced in NeXa. It is not a Gas Safe, manufacturer Benchmark, OFTEC or Scottish Building Standards certificate and does not replace those notification systems.";
