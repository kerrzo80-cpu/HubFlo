import {
  generateEstimateFromSurvey,
  reviewSurveyCompletion,
  seededPricingProfiles,
  seededSimproEstimateMappings,
  type EstimateCorrection,
  type EstimateLabourLine,
  type EstimateMaterialLine,
  type EstimateRecord,
  type PricingProfile,
  type SurveyAnswer,
  type SurveyCompletionReview,
  type SurveyEquipmentItem,
  type SurveyJobType,
  type SurveyPhoto,
  type SurveyPipeRun,
  type SurveyRecord,
  type SurveyRoom,
  type SurveyScopeItem,
} from "@hubflo/domain";

import { getTakeoffProjects, type TakeoffPipeRun, type TakeoffProject } from "@/lib/takeoff-data";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

const storeName = "survey-estimator-v1";
const schemaVersion = 1;

type SurveyEstimatorStore = {
  schemaVersion: number;
  surveys: SurveyRecord[];
  estimates: EstimateRecord[];
  idempotency: Record<string, string>;
  migratedTakeoffProjectIds: string[];
};

type MutationContext = {
  tenantId: string;
  actor: string;
};

export type VersionedMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "version_conflict" | "invalid_state"; current?: T; message: string };

const emptyStore: SurveyEstimatorStore = {
  schemaVersion,
  surveys: [],
  estimates: [],
  idempotency: {},
  migratedTakeoffProjectIds: [],
};

let store = normaliseStore(loadServerStore<SurveyEstimatorStore>(storeName, emptyStore));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normaliseStore(value: SurveyEstimatorStore): SurveyEstimatorStore {
  return {
    schemaVersion,
    surveys: Array.isArray(value.surveys) ? value.surveys : [],
    estimates: Array.isArray(value.estimates) ? value.estimates : [],
    idempotency: value.idempotency && typeof value.idempotency === "object" ? value.idempotency : {},
    migratedTakeoffProjectIds: Array.isArray(value.migratedTakeoffProjectIds) ? value.migratedTakeoffProjectIds : [],
  };
}

function persist() {
  writeServerStore(storeName, store);
}

function nextReference(prefix: "SV" | "EST", records: Array<{ reference: string }>) {
  const highest = records.reduce((current, record) => {
    const match = record.reference.match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 3000);
  return `${prefix}-${highest + 1}`;
}

function audit(actor: string, action: string, detail: string) {
  return { id: makeId("survey-audit"), at: nowIso(), actor, action, detail };
}

function inferJobType(project: TakeoffProject): SurveyJobType {
  const text = [project.name, project.description, project.surveyWorkflow?.projectType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/boiler.*relocat|relocat.*boiler/.test(text)) return "Boiler relocation";
  if (/boiler/.test(text)) return "Boiler change";
  if (/bath|wet.?room|shower/.test(text)) return "Bathroom or wet room";
  if (/underfloor|ufh/.test(text)) return "Underfloor heating";
  if (/air.?source|ashp/.test(text)) return "ASHP";
  if (/radiator|towel/.test(text)) return "Radiators or towel rails";
  if (/full heating/.test(text)) return "Full heating system";
  if (/heating/.test(text)) return "Heating alterations";
  if (/kitchen/.test(text)) return "Kitchen plumbing";
  if (/tender|commercial/.test(text)) return "Commercial or tender work";
  if (/plumb/.test(text)) return "General plumbing";
  return "Custom survey";
}

function legacyPipeService(service: TakeoffPipeRun["service"]): SurveyPipeRun["service"] {
  const services: Record<TakeoffPipeRun["service"], SurveyPipeRun["service"]> = {
    "Heating flow/return": "Heating flow",
    "Hot water": "Hot",
    "Cold water": "Cold",
    Gas: "Gas",
    Waste: "Waste",
    Condensate: "Condensate",
    Other: "Other",
  };
  return services[service];
}

function legacyAnswers(project: TakeoffProject, updatedAt: string): SurveyAnswer[] {
  const workflow = project.surveyWorkflow;
  const answers: SurveyAnswer[] = (workflow?.aiQuestions ?? [])
    .filter((question) => question.answer.trim())
    .map((question) => ({
      id: question.id,
      key: `legacy-${question.id}`,
      section: question.section,
      question: question.question,
      value: question.answer,
      status: "Confirmed" as const,
      notes: "Imported from the previous Survey conversation.",
      photoIds: [],
      updatedAt,
    }));

  if (workflow?.scopeNotes.trim()) {
    answers.unshift({
      id: makeId("survey-answer"),
      key: "legacy-scope-notes",
      section: "Existing survey notes",
      question: "Previous survey scope notes",
      value: workflow.scopeNotes,
      status: "Confirmed",
      notes: "Imported as evidence only. No previous generated prices were copied.",
      photoIds: [],
      updatedAt,
    });
  }
  return answers;
}

function migrateTakeoffProject(project: TakeoffProject, tenantId = "pilot-ewg"): SurveyRecord {
  const updatedAt = project.updatedAt || nowIso();
  const surveyPhotos: SurveyPhoto[] = project.documents
    .filter((document) => document.kind === "Survey photo")
    .map((document) => ({
      id: document.id,
      category: "Other",
      fileName: document.fileName,
      mimeType: document.mimeType || "application/octet-stream",
      size: document.size || 0,
      storageKey: document.storageKey || `legacy:${document.id}`,
      caption: document.notes.join(" "),
      capturedAt: document.uploadedAt,
      surveySection: "Legacy survey evidence",
    }));
  const rooms: SurveyRoom[] = project.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    lengthM: room.lengthM,
    widthM: room.widthM,
    heightM: room.heightM,
    wallConstruction: room.construction || "TBC",
    floorConstruction: "TBC",
    ceilingConstruction: "TBC",
    accessNotes: room.notes,
    photoIds: [],
  }));
  const pipeRuns: SurveyPipeRun[] = project.pipeRuns.map((run) => ({
    id: run.id,
    service: legacyPipeService(run.service),
    fromLocation: "TBC",
    toLocation: run.route || "TBC",
    measuredLengthM: run.lengthM || undefined,
    pipeSize: run.diameter,
    material: run.material,
    route: run.route,
    insulationRequired: run.insulation,
    directionChanges: run.fittings ? [{ type: "Unspecified fitting", quantity: run.fittings }] : [],
    accessDifficulty: "TBC",
    fireStopping: false,
    coreDrilling: false,
    makingGood: false,
    measurementStatus: run.lengthM ? "Allowance" : "TBC",
    tbcReason: run.lengthM ? undefined : "The previous survey did not record a measured length.",
    notes: `${run.notes}${run.service === "Heating flow/return" ? " Previous record combined heating flow and return." : ""}`.trim(),
    photoIds: [],
  }));
  const equipmentItems: SurveyEquipmentItem[] = project.radiators.map((radiator) => ({
    id: radiator.id,
    category: "Radiator",
    roomOrArea: radiator.roomName,
    description: radiator.model || "Radiator selection TBC",
    make: "",
    model: radiator.model,
    supplierCode: "",
    quantity: radiator.quantity,
    dimensions: "",
    outputOrCapacity: radiator.outputWatts ? `${radiator.outputWatts} W` : "",
    connectionRequirements: "TBC",
    rfqRequired: radiator.supplierRequired,
    status: radiator.supplierRequired ? "TBC" : "Provisional",
    tbcReason: radiator.supplierRequired ? "Supplier model and price confirmation required." : undefined,
    notes: radiator.notes,
    photoIds: [],
  }));

  return {
    id: makeId("survey"),
    tenantId,
    reference: nextReference("SV", store.surveys),
    version: 1,
    status: "Draft",
    customerName: project.customer,
    siteAddress: project.site,
    primaryContact: { name: "", email: "", phone: "" },
    additionalContacts: [],
    jobLink: project.linkedJobId
      ? { type: "Job", id: project.linkedJobId, reference: project.linkedJobRef || project.linkedJobId }
      : project.linkedQuoteId
        ? { type: "Quote", id: project.linkedQuoteId, reference: project.linkedQuoteRef || project.linkedQuoteId }
        : undefined,
    surveyorName: "NeXa legacy import",
    surveyDate: project.createdAt.slice(0, 10),
    customerRequirements: project.description,
    occupancy: "Unknown",
    market: /commercial|tender/i.test(project.description) ? "Commercial" : "Domestic",
    jobType: inferJobType(project),
    answers: legacyAnswers(project, updatedAt),
    rooms,
    scopeItems: [],
    pipeRuns,
    equipmentItems,
    photos: surveyPhotos,
    workByOthers: [],
    assumptions: ["Imported from the previous Survey/Takeoff record for review."],
    assistantMessages: [],
    legacyTakeoffProjectId: project.id,
    audit: [audit("NeXa migration", "Imported", `${project.reference} evidence imported without generated estimate prices.`)],
    createdAt: project.createdAt,
    updatedAt,
  };
}

function ensureLegacyMigration() {
  const projects = getTakeoffProjects();
  let changed = false;
  for (const project of projects) {
    if (store.migratedTakeoffProjectIds.includes(project.id)) continue;
    store.surveys.push(migrateTakeoffProject(project));
    store.migratedTakeoffProjectIds.push(project.id);
    changed = true;
  }
  if (changed) persist();
}

function defaultSurvey(input: Partial<SurveyRecord>, context: MutationContext): SurveyRecord {
  const createdAt = nowIso();
  return {
    id: input.id || makeId("survey"),
    tenantId: context.tenantId,
    reference: input.reference || nextReference("SV", store.surveys),
    version: 1,
    status: "Draft",
    customerId: input.customerId,
    customerName: input.customerName?.trim() || "",
    siteId: input.siteId,
    siteAddress: input.siteAddress?.trim() || "",
    primaryContact: input.primaryContact || { name: "", email: "", phone: "" },
    additionalContacts: input.additionalContacts || [],
    jobLink: input.jobLink,
    surveyorId: input.surveyorId,
    surveyorName: input.surveyorName?.trim() || context.actor,
    surveyDate: input.surveyDate || createdAt.slice(0, 10),
    requiredByDate: input.requiredByDate,
    customerRequirements: input.customerRequirements || "",
    occupancy: input.occupancy || "Unknown",
    market: input.market || "Domestic",
    jobType: input.jobType || "General plumbing",
    answers: input.answers || [],
    rooms: input.rooms || [],
    scopeItems: input.scopeItems || [],
    pipeRuns: input.pipeRuns || [],
    equipmentItems: input.equipmentItems || [],
    photos: input.photos || [],
    workByOthers: input.workByOthers || [],
    assumptions: input.assumptions || [],
    assistantMessages: input.assistantMessages || [],
    legacyTakeoffProjectId: input.legacyTakeoffProjectId,
    audit: [audit(context.actor, "Created", "Survey draft created.")],
    createdAt,
    updatedAt: createdAt,
  };
}

export function getSurveys(tenantId: string) {
  ensureLegacyMigration();
  return clone(store.surveys.filter((survey) => survey.tenantId === tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export function getSurvey(tenantId: string, id: string) {
  ensureLegacyMigration();
  const survey = store.surveys.find((item) => item.tenantId === tenantId && (item.id === id || item.reference === id));
  return survey ? clone(survey) : undefined;
}

export function createSurvey(
  input: Partial<SurveyRecord>,
  context: MutationContext,
  clientMutationId?: string,
) {
  ensureLegacyMigration();
  const key = clientMutationId ? `${context.tenantId}:create-survey:${clientMutationId}` : "";
  if (key && store.idempotency[key]) {
    const existing = getSurvey(context.tenantId, store.idempotency[key]);
    if (existing) return existing;
  }
  const survey = defaultSurvey(input, context);
  store.surveys.unshift(survey);
  if (key) store.idempotency[key] = survey.id;
  persist();
  return clone(survey);
}

export function updateSurvey(
  tenantId: string,
  id: string,
  patch: Partial<SurveyRecord>,
  expectedVersion: number | undefined,
  actor: string,
  auditOverride?: { action: string; detail: string },
): VersionedMutationResult<SurveyRecord> {
  ensureLegacyMigration();
  const index = store.surveys.findIndex((item) => item.tenantId === tenantId && (item.id === id || item.reference === id));
  const current = index >= 0 ? store.surveys[index] : undefined;
  if (!current) return { ok: false, reason: "not_found", message: "Survey not found." };
  if (expectedVersion !== undefined && expectedVersion !== current.version) {
    return { ok: false, reason: "version_conflict", current: clone(current), message: "This survey changed on another device. Reload before saving again." };
  }

  const protectedKeys: Array<keyof SurveyRecord> = ["id", "tenantId", "reference", "version", "createdAt", "completedAt", "sentToEstimatorAt", "estimateId", "audit"];
  const safePatch = { ...patch };
  protectedKeys.forEach((key) => delete safePatch[key]);
  const updatedAt = nowIso();
  const updated: SurveyRecord = {
    ...current,
    ...safePatch,
    primaryContact: patch.primaryContact ? { ...current.primaryContact, ...patch.primaryContact } : current.primaryContact,
    id: current.id,
    tenantId: current.tenantId,
    reference: current.reference,
    version: current.version + 1,
    audit: [
      ...current.audit,
      audit(
        actor,
        auditOverride?.action || "Autosaved",
        auditOverride?.detail || `Survey version ${current.version + 1} saved.`,
      ),
    ].slice(-200),
    createdAt: current.createdAt,
    updatedAt,
  };
  store.surveys[index] = updated;
  persist();
  return { ok: true, value: clone(updated) };
}

type RepeatableSurveyItem = SurveyScopeItem | SurveyPipeRun | SurveyEquipmentItem | SurveyRoom | SurveyPhoto;
export type RepeatableSurveyKey = "scopeItems" | "pipeRuns" | "equipmentItems" | "rooms" | "photos";

export function upsertSurveyItem<T extends RepeatableSurveyItem>(
  tenantId: string,
  surveyId: string,
  key: RepeatableSurveyKey,
  item: T,
  expectedVersion: number | undefined,
  actor: string,
): VersionedMutationResult<SurveyRecord> {
  const survey = getSurvey(tenantId, surveyId);
  if (!survey) return { ok: false, reason: "not_found", message: "Survey not found." };
  const currentItems = survey[key] as RepeatableSurveyItem[];
  const nextItems = currentItems.some((current) => current.id === item.id)
    ? currentItems.map((current) => current.id === item.id ? item : current)
    : [...currentItems, item];
  return updateSurvey(tenantId, survey.id, { [key]: nextItems } as Partial<SurveyRecord>, expectedVersion, actor);
}

export function getSurveyCompletionReview(tenantId: string, id: string): SurveyCompletionReview | undefined {
  const survey = getSurvey(tenantId, id);
  return survey ? reviewSurveyCompletion(survey) : undefined;
}

export function completeSurvey(
  tenantId: string,
  id: string,
  expectedVersion: number | undefined,
  actor: string,
): VersionedMutationResult<SurveyRecord> & { review?: SurveyCompletionReview } {
  const survey = getSurvey(tenantId, id);
  if (!survey) return { ok: false, reason: "not_found", message: "Survey not found." };
  const review = reviewSurveyCompletion(survey);
  if (!review.canComplete) return { ok: false, reason: "invalid_state", current: survey, message: "Resolve the blocking completion items first.", review };
  const result = updateSurvey(tenantId, survey.id, { status: "Complete" }, expectedVersion, actor);
  if (!result.ok) return { ...result, review };
  const index = store.surveys.findIndex((item) => item.id === result.value.id && item.tenantId === tenantId);
  const completedAt = nowIso();
  store.surveys[index] = {
    ...result.value,
    status: "Complete",
    completedAt,
    audit: [...result.value.audit, audit(actor, "Completed", "Survey completion review passed.")],
  };
  persist();
  return { ok: true, value: clone(store.surveys[index]), review };
}

function createEstimateFromSurvey(survey: SurveyRecord): EstimateRecord {
  const createdAt = nowIso();
  const pricingProfile = seededPricingProfiles.find((profile) => profile.market === survey.market) || seededPricingProfiles[0]!;
  const generated = generateEstimateFromSurvey(survey, pricingProfile, {}, createdAt);
  return {
    id: makeId("estimate"),
    tenantId: survey.tenantId,
    reference: nextReference("EST", store.estimates),
    surveyId: survey.id,
    sourceSurveyVersion: survey.version,
    version: 1,
    status: "In review",
    pricingProfile: clone(pricingProfile),
    scopeOfWorks: generated.scopeOfWorks,
    questions: generated.questions,
    assumptions: generated.assumptions,
    exclusions: generated.exclusions,
    riskNotes: generated.riskNotes,
    materialLines: generated.materialLines,
    labourLines: generated.labourLines,
    corrections: [],
    generationRuns: [generated.generationRun],
    simproMappings: clone(seededSimproEstimateMappings),
    createdAt,
    updatedAt: createdAt,
  };
}

function regenerateEstimateFromSurvey(estimate: EstimateRecord, survey: SurveyRecord, actor: string): EstimateRecord {
  const updatedAt = nowIso();
  const generated = generateEstimateFromSurvey(survey, estimate.pricingProfile, {}, updatedAt);
  return {
    ...estimate,
    sourceSurveyVersion: survey.version,
    version: estimate.version + 1,
    status: "In review",
    scopeOfWorks: generated.scopeOfWorks,
    questions: generated.questions,
    assumptions: generated.assumptions,
    exclusions: generated.exclusions,
    riskNotes: generated.riskNotes,
    materialLines: generated.materialLines,
    labourLines: generated.labourLines,
    generationRuns: [...estimate.generationRuns, {
      ...generated.generationRun,
      summary: `${generated.generationRun.summary} Regenerated by ${actor}.`,
    }].slice(-100),
    updatedAt,
  };
}

export function sendSurveyToEstimator(
  tenantId: string,
  id: string,
  expectedVersion: number | undefined,
  actor: string,
): VersionedMutationResult<{ survey: SurveyRecord; estimate: EstimateRecord }> {
  const survey = getSurvey(tenantId, id);
  if (!survey) return { ok: false, reason: "not_found", message: "Survey not found." };
  if (survey.status !== "Complete" && survey.status !== "Sent to estimator") {
    return { ok: false, reason: "invalid_state", current: undefined, message: "Complete the survey review before sending it to Estimator." };
  }
  if (expectedVersion !== undefined && expectedVersion !== survey.version) {
    return { ok: false, reason: "version_conflict", message: "The survey changed before it was sent. Reload and try again." };
  }
  let estimate = store.estimates.find((item) => item.tenantId === tenantId && item.surveyId === survey.id);
  if (!estimate) {
    estimate = createEstimateFromSurvey(survey);
    store.estimates.unshift(estimate);
  } else if (estimate.sourceSurveyVersion !== survey.version) {
    const estimateIndex = store.estimates.findIndex((item) => item.id === estimate?.id && item.tenantId === tenantId);
    estimate = regenerateEstimateFromSurvey(estimate, survey, actor);
    store.estimates[estimateIndex] = estimate;
  }
  const index = store.surveys.findIndex((item) => item.id === survey.id && item.tenantId === tenantId);
  const sentAt = nowIso();
  const updatedSurvey: SurveyRecord = {
    ...survey,
    status: "Sent to estimator",
    estimateId: estimate.id,
    sentToEstimatorAt: sentAt,
    version: survey.version + 1,
    updatedAt: sentAt,
    audit: [...survey.audit, audit(actor, "Sent to estimator", `${estimate.reference} created or updated.`)].slice(-200),
  };
  store.surveys[index] = updatedSurvey;
  persist();
  return { ok: true, value: { survey: clone(updatedSurvey), estimate: clone(estimate) } };
}

export function getEstimates(tenantId: string) {
  return clone(store.estimates.filter((estimate) => estimate.tenantId === tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export function getEstimate(tenantId: string, id: string) {
  const estimate = store.estimates.find((item) => item.tenantId === tenantId && (item.id === id || item.reference === id));
  return estimate ? clone(estimate) : undefined;
}

export function regenerateEstimate(
  tenantId: string,
  id: string,
  expectedVersion: number | undefined,
  actor: string,
): VersionedMutationResult<EstimateRecord> {
  const index = store.estimates.findIndex((item) => item.tenantId === tenantId && (item.id === id || item.reference === id));
  const estimate = index >= 0 ? store.estimates[index] : undefined;
  if (!estimate) return { ok: false, reason: "not_found", message: "Estimate not found." };
  if (expectedVersion !== undefined && expectedVersion !== estimate.version) {
    return { ok: false, reason: "version_conflict", current: clone(estimate), message: "This estimate changed on another device. Reload before regenerating it." };
  }
  const survey = store.surveys.find((item) => item.tenantId === tenantId && item.id === estimate.surveyId);
  if (!survey) return { ok: false, reason: "invalid_state", current: clone(estimate), message: "The source survey could not be found." };
  const regenerated = regenerateEstimateFromSurvey(estimate, survey, actor);
  store.estimates[index] = regenerated;
  persist();
  return { ok: true, value: clone(regenerated) };
}

type EstimateLineUpdate =
  | { lineType: "Material"; lineId: string; patch: Partial<EstimateMaterialLine> }
  | { lineType: "Labour"; lineId: string; patch: Partial<EstimateLabourLine> };

export function updateEstimateLine(
  tenantId: string,
  id: string,
  expectedVersion: number | undefined,
  update: EstimateLineUpdate,
  correctionReason: string,
  actor: string,
  reusable = false,
): VersionedMutationResult<EstimateRecord> {
  const index = store.estimates.findIndex((item) => item.tenantId === tenantId && (item.id === id || item.reference === id));
  const estimate = index >= 0 ? store.estimates[index] : undefined;
  if (!estimate) return { ok: false, reason: "not_found", message: "Estimate not found." };
  if (expectedVersion !== undefined && expectedVersion !== estimate.version) {
    return { ok: false, reason: "version_conflict", current: clone(estimate), message: "This estimate changed on another device. Reload before saving the correction." };
  }
  if (!correctionReason.trim()) {
    return { ok: false, reason: "invalid_state", current: clone(estimate), message: "Record a correction reason before changing an estimate line." };
  }

  const protectedKeys = ["id", "sourceType", "sourceId"] as const;
  const safePatch = { ...update.patch } as Record<string, unknown>;
  protectedKeys.forEach((key) => delete safePatch[key]);
  let found = false;
  let materialLines = estimate.materialLines;
  let labourLines = estimate.labourLines;
  if (update.lineType === "Material") {
    materialLines = estimate.materialLines.map((line) => {
      if (line.id !== update.lineId) return line;
      found = true;
      return { ...line, ...safePatch, id: line.id, sourceType: line.sourceType, sourceId: line.sourceId } as EstimateMaterialLine;
    });
  } else {
    labourLines = estimate.labourLines.map((line) => {
      if (line.id !== update.lineId) return line;
      found = true;
      return { ...line, ...safePatch, id: line.id, sourceType: line.sourceType, sourceId: line.sourceId } as EstimateLabourLine;
    });
  }
  if (!found) return { ok: false, reason: "not_found", current: clone(estimate), message: "Estimate line not found." };

  const correction: EstimateCorrection = {
    id: makeId("estimate-correction"),
    lineType: update.lineType,
    lineId: update.lineId,
    reason: correctionReason.trim(),
    actor,
    createdAt: nowIso(),
    reusable,
  };
  const updated: EstimateRecord = {
    ...estimate,
    version: estimate.version + 1,
    status: "In review",
    materialLines,
    labourLines,
    corrections: [...estimate.corrections, correction].slice(-300),
    updatedAt: correction.createdAt,
  };
  store.estimates[index] = updated;
  persist();
  return { ok: true, value: clone(updated) };
}

export function recordEstimateQuotePush(
  tenantId: string,
  id: string,
  expectedVersion: number | undefined,
  quote: { id: string; ref: string },
): VersionedMutationResult<EstimateRecord> {
  const index = store.estimates.findIndex((item) => item.tenantId === tenantId && (item.id === id || item.reference === id));
  const estimate = index >= 0 ? store.estimates[index] : undefined;
  if (!estimate) return { ok: false, reason: "not_found", message: "Estimate not found." };
  if (expectedVersion !== undefined && expectedVersion !== estimate.version) {
    return { ok: false, reason: "version_conflict", current: clone(estimate), message: "This estimate changed before it was pushed. Reload and review it again." };
  }
  const pushedAt = nowIso();
  const updated: EstimateRecord = {
    ...estimate,
    version: estimate.version + 1,
    status: "Pushed",
    coreQuoteId: quote.id,
    coreQuoteRef: quote.ref,
    pushedAt,
    updatedAt: pushedAt,
  };
  store.estimates[index] = updated;
  persist();
  return { ok: true, value: clone(updated) };
}

export function updateEstimatePricingProfile(
  tenantId: string,
  id: string,
  expectedVersion: number | undefined,
  patch: Partial<PricingProfile>,
  correctionReason: string,
  actor: string,
): VersionedMutationResult<EstimateRecord> {
  const index = store.estimates.findIndex((item) => item.tenantId === tenantId && (item.id === id || item.reference === id));
  const estimate = index >= 0 ? store.estimates[index] : undefined;
  if (!estimate) return { ok: false, reason: "not_found", message: "Estimate not found." };
  if (expectedVersion !== undefined && expectedVersion !== estimate.version) {
    return { ok: false, reason: "version_conflict", current: clone(estimate), message: "This estimate changed on another device. Reload before changing its pricing profile." };
  }
  if (!correctionReason.trim()) return { ok: false, reason: "invalid_state", current: clone(estimate), message: "Record why the estimate pricing profile is changing." };
  const previous = estimate.pricingProfile;
  const next: PricingProfile = {
    ...previous,
    ...patch,
    id: patch.id?.trim() || previous.id,
    name: patch.name?.trim() || previous.name,
  };
  const updatedAt = nowIso();
  const correction: EstimateCorrection = {
    id: makeId("estimate-correction"), lineType: "Scope", lineId: "pricing-profile", reason: correctionReason.trim(), actor, createdAt: updatedAt, reusable: false,
  };
  const updated: EstimateRecord = {
    ...estimate,
    version: estimate.version + 1,
    status: "In review",
    pricingProfile: next,
    materialLines: estimate.materialLines.map((line) => line.markupPercent === previous.materialMarkupPercent ? { ...line, markupPercent: next.materialMarkupPercent } : line),
    labourLines: estimate.labourLines.map((line) => line.sellRate === previous.labourSellRate ? { ...line, sellRate: next.labourSellRate } : line),
    corrections: [...estimate.corrections, correction].slice(-300),
    updatedAt,
  };
  store.estimates[index] = updated;
  persist();
  return { ok: true, value: clone(updated) };
}

export function resetSurveyEstimatorStoreForTests(nextStore: Partial<SurveyEstimatorStore> = {}) {
  store = normaliseStore({ ...emptyStore, ...nextStore });
  persist();
}
