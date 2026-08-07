import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import { useDemoSeedData } from "@/lib/workspace-mode";
import {
  mergeDayworkSheets,
  mergeFlowStepEvidence,
  mergeInvoicesById,
  mergeJobDeliveryEvents,
} from "@/lib/hub-state-merge";
import {
  mergeDayworkSheetsIntoStore,
  readDayworkSheetsStore,
} from "@/lib/daywork-sheets-store";

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
export function saveHubDetailState(nextState: HubDetailState): HubDetailState {
  rehydrateDayworkFieldsFromDisk();
  const liveSheets = mergeDayworkSheets(readDayworkSheetsStore(), hubDetailState.dayworkSheets);
  const updated: HubDetailState = {
    ...nextState,
    dayworkSheets: mergeDayworkSheets(liveSheets, nextState.dayworkSheets) as Record<string, unknown>,
    flowStepEvidence: mergeFlowStepEvidence(hubDetailState.flowStepEvidence, nextState.flowStepEvidence),
    flowStepCompletion: {
      ...((hubDetailState.flowStepCompletion || {}) as Record<string, unknown>),
      ...((nextState.flowStepCompletion || {}) as Record<string, unknown>),
    },
    jobDeliveryEvents: mergeJobDeliveryEvents(hubDetailState.jobDeliveryEvents, nextState.jobDeliveryEvents),
    jobCostCentres: mergeCentresPreserveDaywork(hubDetailState.jobCostCentres, nextState.jobCostCentres),
    // Field auto-drafts and office invoice edits must survive stale Core PUT payloads.
    invoices: mergeInvoicesById(hubDetailState.invoices, nextState.invoices) as unknown[],
    updatedAt: new Date().toISOString(),
  };

  Object.keys(hubDetailState).forEach((key) => {
    delete hubDetailState[key as keyof HubDetailState];
  });
  Object.assign(hubDetailState, updated);
  writeServerStore("hub-detail-store", hubDetailState);
  if (updated.dayworkSheets) {
    mergeDayworkSheetsIntoStore(updated.dayworkSheets);
  }
  return clone(hubDetailState);
}

export function getHubDetailState(): HubDetailState {
  // Always surface dedicated daywork sheets, even if a prior hub write dropped them.
  rehydrateDayworkFieldsFromDisk();
  const sheets = mergeDayworkSheets(readDayworkSheetsStore(), hubDetailState.dayworkSheets);
  return clone({
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
