export const DOMESTIC_STOP_GO_STORE = "nexa-domestic-stop-go-v1";
export const DOMESTIC_TENANT_ID = "pilot-ewg";
export const TEMPLATE_VERSION = 1;

export type PropertyScope = "domestic";
export type WorkflowMode = "mandatory_stop_go";

export type WorkflowRunStatus =
  | "not_started"
  | "in_progress"
  | "blocked_missing_required"
  | "blocked_unsafe"
  | "awaiting_engineer_signature"
  | "awaiting_customer_acknowledgement"
  | "complete"
  | "superseded"
  | "cancelled";

export type FieldAnswerStatus = "answered" | "not_applicable" | "not_tested" | "unable_to_access" | "tbc";

export type FieldDataType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "yes_no"
  | "choice"
  | "date"
  | "time"
  | "datetime"
  | "photo"
  | "signature"
  | "repeat_group";

export type SafetySeverity = "info" | "warning" | "critical";

export type RuleType =
  | "required"
  | "required_if"
  | "visible_if"
  | "must_equal"
  | "range"
  | "date_after"
  | "at_least_one_repeat_item"
  | "evidence_required_if"
  | "signature_required"
  | "blocks_gate"
  | "launch_linked_workflow"
  | "invalidates_downstream";

export type FieldCondition = {
  field: string;
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
  isEmpty?: boolean;
};

export type WorkflowRule = {
  type: RuleType;
  fieldKey?: string;
  gateKey?: string;
  message: string;
  code: string;
  severity?: "blocking" | "warning";
  when?: FieldCondition;
  equals?: unknown;
  min?: number;
  max?: number;
  afterField?: string;
  groupKey?: string;
  targetCostCentreCode?: string;
  hardStop?: boolean;
};

export type WorkflowField = {
  fieldKey: string;
  label: string;
  helpText?: string;
  dataType: FieldDataType;
  unit?: string;
  requiredRule: "optional" | "required" | "required_if";
  requiredIf?: FieldCondition;
  visibleIf?: FieldCondition;
  allowNa?: boolean;
  naReasonRequired?: boolean;
  allowNotTested?: boolean;
  notTestedReasonRequired?: boolean;
  allowUnable?: boolean;
  allowTbc?: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  pattern?: string;
  safetySeverity?: SafetySeverity;
  pdfSection: string;
  pdfOrder: number;
  groupKey?: string;
  evidenceRequired?: boolean;
  invalidatesDownstream?: boolean;
  systemPopulated?: boolean;
  inputKind?: "text" | "date" | "time" | "digits" | "decimal" | "textarea" | "signature";
  placeholder?: string;
};

export type WorkflowGate = {
  key: string;
  label: string;
  summary: string;
  fieldKeys: string[];
  shared?: "A" | "B" | "C" | "D";
};

export type WorkflowTemplate = {
  id: string;
  tenantId: string | null;
  costCentreCode: string;
  version: number;
  status: "published";
  effectiveFrom: string;
  recordTitle: string;
  pdfTemplateKey: string;
  fuel: "gas" | "oil";
  competencyScheme: "Gas Safe" | "OFTEC";
  linkedUnsafeCode?: string;
  disclaimer: string;
  gates: WorkflowGate[];
  fields: WorkflowField[];
  rules: WorkflowRule[];
  createdBy: string;
  publishedAt: string;
};

export type DomesticCostCentre = {
  id: string;
  tenantId: string;
  stableCode: string;
  displayName: string;
  propertyScope: PropertyScope;
  workflowMode: WorkflowMode;
  active: boolean;
  recordTitle: string;
};

export type WorkflowAnswer = {
  id: string;
  runId: string;
  fieldKey: string;
  repeatGroupId: string | null;
  value: unknown;
  answerStatus: FieldAnswerStatus;
  reason?: string;
  answeredBy: string;
  answeredAt: string;
  source: "engineer" | "system" | "office";
  revision: number;
  clientRevision?: number;
  syncId?: string;
  deviceTimestamp?: string;
};

export type WorkflowEvidence = {
  id: string;
  runId: string;
  fieldKey: string;
  fileId: string;
  caption: string;
  capturedBy: string;
  capturedAt: string;
  deviceTimestamp: string;
  serverTimestamp: string;
  sha256: string;
  photoUrl?: string;
  photoName?: string;
};

export type WorkflowSignature = {
  id: string;
  runId: string;
  role: "engineer" | "customer" | "responsible_person";
  signerName: string;
  signerCapacity: string;
  signatureFileId?: string;
  signatureDataUrl?: string;
  status: "signed" | "refused_to_sign" | "not_present";
  refusalReason?: string;
  signedAt: string;
  signedByUserId?: string;
};

export type WorkflowRun = {
  id: string;
  tenantId: string;
  jobId: string;
  jobCostCentreId: string;
  scheduleId?: string;
  templateId: string;
  templateVersion: number;
  costCentreCode: string;
  status: WorkflowRunStatus;
  currentGateKey: string;
  startedBy: string;
  startedAt: string;
  completedAt?: string;
  linkedUnsafeRunId?: string;
  originatingRunId?: string;
  revision: number;
  invalidatedFromGateKey?: string;
  readyToCompleteWhenConnected?: boolean;
  highPriorityFollowUp?: {
    open: boolean;
    createdAt: string;
    closedAt?: string;
    closedBy?: string;
    closeReason?: string;
  };
};

export type GeneratedRecord = {
  id: string;
  runId: string;
  tenantId: string;
  jobId: string;
  recordType: string;
  recordNumber: string;
  dataSnapshot: Record<string, unknown>;
  pdfFileId?: string;
  pdfDocumentId?: string;
  schemaVersion: number;
  generatedAt: string;
  lockedAt: string;
  supersedesId?: string;
  verificationCode: string;
};

export type WorkflowAuditEvent = {
  id: string;
  runId: string;
  actorId: string;
  eventType: string;
  fieldKey?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  occurredAt: string;
  deviceId?: string;
  syncId?: string;
};

export type EmployeeCompetency = {
  id: string;
  employeeId: string;
  scheme: "Gas Safe" | "OFTEC";
  category: string;
  registrationNumber: string;
  validFrom: string;
  expiresAt: string;
  evidenceFileId?: string;
  active: boolean;
};

export type ClassificationOption = {
  id: string;
  scheme: "gas" | "oil";
  label: string;
  active: boolean;
};

export type TenantStopGoSettings = {
  tenantId: string;
  recordPrefix: string;
  nextRecordNumber: number;
  photoEvidenceOnPdf: boolean;
  customerPdfVisible: boolean;
  unsafeClassifications: ClassificationOption[];
  oilClassifications: ClassificationOption[];
};

export type DomesticStopGoStore = {
  tenantId: string;
  costCentres: DomesticCostCentre[];
  settings: TenantStopGoSettings;
  competencies: EmployeeCompetency[];
  runs: WorkflowRun[];
  answers: WorkflowAnswer[];
  evidence: WorkflowEvidence[];
  signatures: WorkflowSignature[];
  records: GeneratedRecord[];
  audit: WorkflowAuditEvent[];
  updatedAt: string;
};

export type RuleError = {
  fieldKey: string;
  code: string;
  severity: "blocking" | "warning";
  message: string;
  gateKey?: string;
};

export type AnswerPatch = {
  fieldKey: string;
  value?: unknown;
  answerStatus?: FieldAnswerStatus;
  reason?: string;
  repeatGroupId?: string | null;
  syncId?: string;
  clientRevision?: number;
  deviceTimestamp?: string;
};
