import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type HubDetailState = {
  documentFolderTemplates?: unknown[];
  engineerFlowTemplate?: unknown;
  flowStepCompletion?: Record<string, unknown>;
  quoteCostCentres?: Record<string, unknown>;
  customQuoteCatalog?: unknown[];
  jobCostCentres?: Record<string, unknown>;
  jobReviews?: Record<string, unknown>;
  jobDeliveryEvents?: unknown[];
  communications?: unknown[];
  invoices?: unknown[];
  updatedAt?: string;
};

const defaultHubDetailState: HubDetailState = {};

const hubDetailState = loadServerStore("hub-detail-store", defaultHubDetailState);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getHubDetailState(): HubDetailState {
  return clone(hubDetailState);
}

export function saveHubDetailState(nextState: HubDetailState): HubDetailState {
  const updated: HubDetailState = {
    ...nextState,
    updatedAt: new Date().toISOString(),
  };
  Object.keys(hubDetailState).forEach((key) => {
    delete hubDetailState[key as keyof HubDetailState];
  });
  Object.assign(hubDetailState, updated);
  writeServerStore("hub-detail-store", hubDetailState);
  return clone(hubDetailState);
}
