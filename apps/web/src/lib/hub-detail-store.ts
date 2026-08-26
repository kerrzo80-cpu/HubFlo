import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import { useDemoSeedData } from "@/lib/workspace-mode";
import {
  mergeDayworkSheets,
  mergeFlowStepEvidence,
  mergeInvoicesById,
  mergeJobDeliveryEvents,
} from "@/lib/hub-state-merge";
import {
  deleteDayworkSheetFromStore,
  mergeDayworkSheetsIntoStore,
  readDayworkSheetsStore,
} from "@/lib/daywork-sheets-store";
import { dayworkSheetKey } from "@/lib/daywork-account-form";
import { leanCentresForTransport, leanJobCostCentresMap } from "@/lib/job-cost-centres-lean";

const JOB_CC_INDEX_STORE = "nexa-job-cc-index-v1";

function jobCcStoreName(jobId: string) {
  return `nexa-job-cc-v1:${jobId}`;
}

/** Tiny per-job centres/sections — rebuild can survive even if hub-detail-store stringify OOMs. */
function writeJobCcSideStore(jobId: string, centres: unknown[], sections: unknown[]) {
  const leaned = leanCentresForTransport(jobId, centres);
  writeServerStore(jobCcStoreName(jobId), {
    centres: leaned,
    sections: Array.isArray(sections) ? sections : [],
    updatedAt: new Date().toISOString(),
  });
  const index = loadServerStore<{ jobIds?: string[] }>(JOB_CC_INDEX_STORE, { jobIds: [] });
  const jobIds = Array.isArray(index.jobIds) ? index.jobIds : [];
  if (!jobIds.includes(jobId)) {
    writeServerStore(JOB_CC_INDEX_STORE, { jobIds: [...jobIds, jobId] });
  }
  return leaned;
}

function overlayJobCcSideStores(state: HubDetailState) {
  const index = readServerStoreSnapshot(JOB_CC_INDEX_STORE) as { jobIds?: string[] } | null;
  const jobIds = Array.isArray(index?.jobIds) ? index.jobIds : [];
  if (!jobIds.length) return;
  const centresMap = asCentres(state.jobCostCentres);
  const sectionsMap = asCentres(state.jobSections);
  let changed = false;
  for (const jobId of jobIds) {
    const side = readServerStoreSnapshot(jobCcStoreName(jobId)) as {
      centres?: unknown[];
      sections?: unknown[];
    } | null;
    if (!side || !Array.isArray(side.centres)) continue;
    centresMap[jobId] = side.centres;
    if (Array.isArray(side.sections)) sectionsMap[jobId] = side.sections;
    changed = true;
  }
  if (changed) {
    state.jobCostCentres = centresMap;
    state.jobSections = sectionsMap;
  }
}

/** Lean every job's centres before hub stringify (other jobs' fat dumps were re-OOMing writes). */
function prepareHubCostCentresForPersist(state: HubDetailState) {
  leanJobCostCentresMap(state.jobCostCentres);
}

export type HubDetailState = {
  businessSettings?: Record<string, unknown>;
  formTemplates?: unknown[];
  activeFormTemplateId?: string;
  workflowRules?: Record<string, unknown>;
  financeSettings?: Record<string, unknown>;
  integrationSettings?: Record<string, unknown>;
  documentFolderTemplates?: unknown[];
  engineerFlowTemplate?: unknown;
  engineerFlowTemplates?: unknown[];
  activeEngineerFlowTemplateId?: string;
  costCentreTypes?: unknown[];
  costCentreFlowAssignmentDrafts?: Record<string, unknown>;
  flowStepCompletion?: Record<string, unknown>;
  flowStepEvidence?: Record<string, unknown>;
  quoteCostCentres?: Record<string, unknown>;
  quoteSections?: Record<string, unknown>;
  quoteSchedulePlans?: Record<string, unknown>;
  jobSchedulePlans?: Record<string, unknown>;
  customQuoteCatalog?: unknown[];
  catalogFolders?: unknown[];
  jobCostCentres?: Record<string, unknown>;
  jobSections?: Record<string, unknown>;
  jobReviews?: Record<string, unknown>;
  jobDeliveryEvents?: unknown[];
  jobVariationSections?: Record<string, unknown>;
  /** Durable Field Daywork Account snapshots keyed by `${jobId}:${costCentreId}`. */
  dayworkSheets?: Record<string, unknown>;
  communications?: unknown[];
  invoices?: unknown[];
  suppliers?: unknown[];
  contacts?: unknown[];
  contractors?: unknown[];
  employees?: unknown[];
  simproExports?: unknown[];
  /** Bumped by gas-cert trial bootstrap to force-clear LGSR evidence once per reset. */
  gasCertTrialResetToken?: string;
  updatedAt?: string;
};

const defaultHubDetailState: HubDetailState = useDemoSeedData()
  ? {}
  : {
      invoices: [],
      communications: [],
      jobDeliveryEvents: [],
      simproExports: [],
    };

const hubDetailState = loadServerStore("hub-detail-store", defaultHubDetailState);

// Overlay dedicated daywork sheet store so Field saves survive hub full-replace races.
hubDetailState.dayworkSheets = mergeDayworkSheets(
  readDayworkSheetsStore(),
  hubDetailState.dayworkSheets,
) as Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asCentres(value: unknown): Record<string, unknown[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown[]>;
}

function mergeCentresPreserveDaywork(currentValue: unknown, nextValue: unknown) {
  const current = asCentres(currentValue);
  const next = asCentres(nextValue);
  const jobIds = new Set([...Object.keys(current), ...Object.keys(next)]);
  const merged: Record<string, unknown[]> = {};
  for (const jobId of jobIds) {
    const currentCentres = Array.isArray(current[jobId]) ? current[jobId] : [];
    const nextCentres = Array.isArray(next[jobId]) ? next[jobId] : [];
    const byId = new Map<string, Record<string, unknown>>();
    for (const item of nextCentres) {
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        byId.set((item as { id: string }).id, item as Record<string, unknown>);
      }
    }
    for (const item of currentCentres) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      if (!id) continue;
      const isDaywork =
        id.includes("daywork") ||
        /daywork/i.test(String(record.name || "")) ||
        /daywork/i.test(String(record.templateName || ""));
      if (isDaywork && !byId.has(id)) byId.set(id, record);
    }
    merged[jobId] = Array.from(byId.values());
  }
  return merged;
}

function rehydrateHubDetailStateFromDisk() {
  const diskHub = readServerStoreSnapshot("hub-detail-store") as HubDetailState | null;
  if (!diskHub || typeof diskHub !== "object") return;
  Object.keys(hubDetailState).forEach((key) => {
    delete hubDetailState[key as keyof HubDetailState];
  });
  Object.assign(hubDetailState, diskHub);
}

/**
 * Pull Field daywork sheets / evidence / events from SQLite before mutating memory.
 * Prevents a Core worker with a stale module cache from wiping another worker’s Field save.
 */
function rehydrateDayworkFieldsFromDisk() {
  const diskHub = readServerStoreSnapshot("hub-detail-store") as HubDetailState | null;
  if (!diskHub || typeof diskHub !== "object") return;
  hubDetailState.dayworkSheets = mergeDayworkSheets(
    diskHub.dayworkSheets,
    hubDetailState.dayworkSheets,
  ) as Record<string, unknown>;
  hubDetailState.flowStepEvidence = mergeFlowStepEvidence(
    diskHub.flowStepEvidence,
    hubDetailState.flowStepEvidence,
  );
  hubDetailState.jobDeliveryEvents = mergeJobDeliveryEvents(
    diskHub.jobDeliveryEvents,
    hubDetailState.jobDeliveryEvents,
  );
  hubDetailState.jobCostCentres = mergeCentresPreserveDaywork(
    diskHub.jobCostCentres,
    hubDetailState.jobCostCentres,
  );
  hubDetailState.invoices = mergeInvoicesById(diskHub.invoices, hubDetailState.invoices) as unknown[];
}

/**
 * Persist hub detail state without letting a concurrent Core save wipe
 * Field daywork sheets / evidence / events written moments earlier.
 */
function safeCloneHub(state: HubDetailState): HubDetailState {
  try {
    return clone(state);
  } catch {
    // Huge / circular payloads can throw or OOM mid-stringify — return a shallow lean view.
    leanJobCostCentresMap(state.jobCostCentres);
    return {
      jobCostCentres: state.jobCostCentres,
      jobSections: state.jobSections,
      quoteCostCentres: state.quoteCostCentres,
      quoteSections: state.quoteSections,
      invoices: state.invoices,
      communications: state.communications,
      jobDeliveryEvents: state.jobDeliveryEvents,
      dayworkSheets: state.dayworkSheets,
      updatedAt: state.updatedAt,
    };
  }
}

function isDayworkCentreRecord(centre: Record<string, unknown>) {
  const id = String(centre.id || "");
  return (
    id.includes("daywork") ||
    /daywork/i.test(String(centre.name || "")) ||
    /daywork/i.test(String(centre.templateName || ""))
  );
}

/**
 * Replace one job's sections/centres without cloning the whole hub (rebuild/heal hot path).
 * By default keeps daywork centres that are not already present in `centres`.
 *
 * `skipRehydrate` — rebuild/heal must use this. Re-parsing the full hub from SQLite
 * doubles peak memory and was OOMing 512MB Render on every BoQ rebuild.
 */
export function writeJobCostCentresAndSections(
  jobId: string,
  centres: unknown[],
  sections: unknown[],
  options?: { preserveDaywork?: boolean; skipRehydrate?: boolean; sideStoreOnly?: boolean },
): void {
  if (!options?.skipRehydrate && !options?.sideStoreOnly) {
    rehydrateDayworkFieldsFromDisk();
  }
  const centresMap = asCentres(hubDetailState.jobCostCentres);
  const sectionsMap = asCentres(hubDetailState.jobSections);
  const existing = Array.isArray(centresMap[jobId]) ? centresMap[jobId] : [];
  const incoming = Array.isArray(centres) ? centres : [];
  const incomingIds = new Set(
    incoming
      .map((row) =>
        row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
          ? (row as { id: string }).id
          : "",
      )
      .filter(Boolean),
  );
  const preserveDaywork = options?.preserveDaywork !== false;
  const dayworkKept = preserveDaywork
    ? existing.filter((row) => {
        if (!row || typeof row !== "object") return false;
        const record = row as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : "";
        return isDayworkCentreRecord(record) && (!id || !incomingIds.has(id));
      })
    : [];
  const nextCentres = [...incoming, ...dayworkKept];
  // Side store first — durable even if the full hub write OOMs below.
  const sideLeaned = writeJobCcSideStore(jobId, nextCentres, Array.isArray(sections) ? sections : []);
  centresMap[jobId] = sideLeaned;
  sectionsMap[jobId] = Array.isArray(sections) ? sections : [];
  hubDetailState.jobCostCentres = centresMap;
  hubDetailState.jobSections = sectionsMap;
  hubDetailState.updatedAt = new Date().toISOString();
  // Rebuild/heal: never stringify the whole hub — side store + in-memory is enough.
  // getHubDetailState overlays side stores on read.
  if (options?.sideStoreOnly) {
    return;
  }
  // Collapse EVERY job's centres before stringify — leftover fat dumps on other jobs
  // were still large enough to kill Render when rebuild rewrote the hub.
  prepareHubCostCentresForPersist(hubDetailState);
  try {
    writeServerStore("hub-detail-store", hubDetailState);
  } catch {
    // Side store already holds this job — memory map is updated; hub persist best-effort.
  }
}

export function saveHubDetailState(nextState: HubDetailState): HubDetailState {
  rehydrateDayworkFieldsFromDisk();
  overlayJobCcSideStores(hubDetailState);
  const liveSheets = mergeDayworkSheets(readDayworkSheetsStore(), hubDetailState.dayworkSheets);
  // Lean inbound centres before merge so a fat browser tab cannot re-inflate the store.
  if (nextState.jobCostCentres && typeof nextState.jobCostCentres === "object") {
    leanJobCostCentresMap(nextState.jobCostCentres);
  }
  const nextJobCostCentres = mergeCentresPreserveDaywork(hubDetailState.jobCostCentres, nextState.jobCostCentres);
  leanJobCostCentresMap(nextJobCostCentres);
  const updated: HubDetailState = {
    ...nextState,
    dayworkSheets: mergeDayworkSheets(liveSheets, nextState.dayworkSheets) as Record<string, unknown>,
    flowStepEvidence: mergeFlowStepEvidence(hubDetailState.flowStepEvidence, nextState.flowStepEvidence),
    flowStepCompletion: {
      ...((hubDetailState.flowStepCompletion || {}) as Record<string, unknown>),
      ...((nextState.flowStepCompletion || {}) as Record<string, unknown>),
    },
    jobDeliveryEvents: mergeJobDeliveryEvents(hubDetailState.jobDeliveryEvents, nextState.jobDeliveryEvents),
    jobCostCentres: nextJobCostCentres,
    // Field auto-drafts and office invoice edits must survive stale Core PUT payloads.
    invoices: mergeInvoicesById(hubDetailState.invoices, nextState.invoices) as unknown[],
    updatedAt: new Date().toISOString(),
  };

  Object.keys(hubDetailState).forEach((key) => {
    delete hubDetailState[key as keyof HubDetailState];
  });
  Object.assign(hubDetailState, updated);
  prepareHubCostCentresForPersist(hubDetailState);
  try {
    writeServerStore("hub-detail-store", hubDetailState);
  } catch {
    // Best-effort — side stores hold rebuilt job centres.
  }
  if (updated.dayworkSheets) {
    mergeDayworkSheetsIntoStore(updated.dayworkSheets);
  }
  return safeCloneHub(hubDetailState);
}

export function getHubDetailState(): HubDetailState {
  // Read the authoritative persisted hub first so Blake and other route bundles never
  // operate on an old module-level employee/invoice/config snapshot.
  rehydrateHubDetailStateFromDisk();
  // Always surface dedicated daywork sheets, even if a prior hub write dropped them.
  rehydrateDayworkFieldsFromDisk();
  // Prefer per-job side stores when a prior hub write failed after rebuild.
  overlayJobCcSideStores(hubDetailState);
  // Lean oversized tender BoQ dumps BEFORE JSON clone — stringify of 400+ lines OOMs 512MB Render.
  if (leanJobCostCentresMap(hubDetailState.jobCostCentres)) {
    prepareHubCostCentresForPersist(hubDetailState);
    try {
      writeServerStore("hub-detail-store", hubDetailState);
    } catch {
      // Best-effort compaction persist.
    }
  }
  const sheets = mergeDayworkSheets(readDayworkSheetsStore(), hubDetailState.dayworkSheets);
  return safeCloneHub({
    ...hubDetailState,
    dayworkSheets: sheets as Record<string, unknown>,
  });
}

export function resetHubDetailState(): HubDetailState {
  Object.keys(hubDetailState).forEach((key) => {
    delete hubDetailState[key as keyof HubDetailState];
  });
  writeServerStore("hub-detail-store", hubDetailState);
  return clone(hubDetailState);
}

/**
 * Hard-remove a Daywork sheet and optional linked variation events.
 * Bypasses merge helpers that would otherwise resurrect deleted keys from side stores.
 */
export function purgeDayworkSheetFromHub(options: {
  jobId: string;
  costCentreId: string;
}): HubDetailState {
  rehydrateHubDetailStateFromDisk();
  rehydrateDayworkFieldsFromDisk();
  const jobId = options.jobId.trim();
  const costCentreId = options.costCentreId.trim();
  const sheetKey = dayworkSheetKey(jobId, costCentreId);

  try {
    deleteDayworkSheetFromStore(jobId, costCentreId);
  } catch {
    // Continue — still clear hub memory.
  }

  const sheets = {
    ...((hubDetailState.dayworkSheets || {}) as Record<string, unknown>),
  };
  delete sheets[sheetKey];
  hubDetailState.dayworkSheets = sheets;

  const events = Array.isArray(hubDetailState.jobDeliveryEvents)
    ? (hubDetailState.jobDeliveryEvents as Array<Record<string, unknown>>).filter((event) => {
        const eventId = String(event.id || "");
        const eventCentre = String(event.costCentreId || "");
        if (eventId === `daywork-${jobId}-${costCentreId}`) return false;
        if (event.kind === "variation" && eventCentre && eventCentre === costCentreId && String(event.jobId || "") === jobId) {
          return false;
        }
        return true;
      })
    : [];
  hubDetailState.jobDeliveryEvents = events;

  const evidence = { ...((hubDetailState.flowStepEvidence || {}) as Record<string, unknown>) };
  const completion = { ...((hubDetailState.flowStepCompletion || {}) as Record<string, unknown>) };
  const prefix = `${jobId}:${costCentreId}:`;
  for (const key of Object.keys(evidence)) {
    if (key.startsWith(prefix)) delete evidence[key];
  }
  for (const key of Object.keys(completion)) {
    if (key.startsWith(prefix)) delete completion[key];
  }
  hubDetailState.flowStepEvidence = evidence;
  hubDetailState.flowStepCompletion = completion;

  const centresByJob = { ...((hubDetailState.jobCostCentres || {}) as Record<string, unknown[]>) };
  const centres = Array.isArray(centresByJob[jobId]) ? [...centresByJob[jobId]] : [];
  const primaryId = `${jobId}-daywork-account`;
  centresByJob[jobId] =
    costCentreId === primaryId
      ? centres
      : centres.filter((centre) => {
          const id = centre && typeof centre === "object" ? String((centre as { id?: string }).id || "") : "";
          return id !== costCentreId;
        });
  hubDetailState.jobCostCentres = centresByJob;

  hubDetailState.updatedAt = new Date().toISOString();
  try {
    writeServerStore("hub-detail-store", hubDetailState);
  } catch {
    // Best-effort persist.
  }
  return safeCloneHub(hubDetailState);
}

/** Hard-remove a job delivery event (e.g. commercial variation) without merge resurrection. */
export function purgeJobDeliveryEventFromHub(options: {
  jobId: string;
  eventId: string;
}): HubDetailState {
  rehydrateHubDetailStateFromDisk();
  const jobId = options.jobId.trim();
  const eventId = options.eventId.trim();
  const events = Array.isArray(hubDetailState.jobDeliveryEvents)
    ? (hubDetailState.jobDeliveryEvents as Array<Record<string, unknown>>).filter((event) => {
        if (String(event.id || "") !== eventId) return true;
        if (String(event.jobId || "") && String(event.jobId || "") !== jobId) return true;
        return false;
      })
    : [];
  hubDetailState.jobDeliveryEvents = events;
  hubDetailState.updatedAt = new Date().toISOString();
  try {
    writeServerStore("hub-detail-store", hubDetailState);
  } catch {
    // Best-effort persist.
  }
  return safeCloneHub(hubDetailState);
}
