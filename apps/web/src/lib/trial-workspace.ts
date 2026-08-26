import { applyEnvCompanyFallback, defaultBusinessBrandingSettings } from "@/lib/branding";
import {
  loadServerStore,
  wipeAllServerStoresExcept,
  wipeServerStoreDirectories,
  writeServerStore,
} from "@/lib/server-store";
import { TRIAL_LICENCE_STORE_NAME } from "@/lib/trial-licence";
import { isTrialCompanyResetAllowed, trialCompanyName } from "@/lib/workspace-mode";

const TRIAL_WIPE_DIRS = [
  "takeoff-files",
  "survey-files",
  "field-photos",
  "record-documents",
  "branding",
  "xero-bills",
  "xero-exports",
  "backups",
];

export const TRIAL_WIPE_STORE = "nexa-trial-wipe-v1";
/** Bump to force another trial disk wipe after deploy. Never run on nexa-live. */
export const TRIAL_WIPE_GENERATION = 1;
export const TRIAL_WIPE_KEEP_STORES = ["auth-store", TRIAL_WIPE_STORE, TRIAL_LICENCE_STORE_NAME] as const;

type TrialWipeState = {
  generation?: number;
  wipedAt?: string;
};

export type TrialWipeResult = {
  ok: true;
  skipped?: boolean;
  reason?: string;
  deletedStores: string[];
  deletedDirs: string[];
  generation: number;
};

function trialBrandingDefaults() {
  const name = trialCompanyName();
  return applyEnvCompanyFallback({
    ...defaultBusinessBrandingSettings,
    companyName: name,
    tradingName: name,
    workspaceName: `${name} workspace`,
    productName: name,
    coreAppName: "Core",
    fieldAppName: "Field",
    surveyAppName: "Survey",
    takeoffsAppName: "Takeoffs",
    heatDesignAppName: "Heat Design",
    trainerAppName: "Trainer",
    hidePlatformName: false,
    logoUrl: "",
    appIconUrl: "",
    portalWelcomeText: "Welcome to your trial workspace. Fill in Setup to add your company name and logo.",
  });
}

function writeBlankOperationalStores() {
  writeServerStore("people-store", { clients: [], clientSites: [], auditEvents: [] });
  writeServerStore("lead-store", { leads: [] });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", {
    businessSettings: trialBrandingDefaults(),
    employees: [],
    customQuoteCatalog: [],
    catalogFolders: [],
    invoices: [],
    communications: [],
    jobDeliveryEvents: [],
    simproExports: [],
    suppliers: [],
    contacts: [],
    contractors: [],
  });
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  writeServerStore("takeoff-store", { projects: [] });
  writeServerStore("takeoff-rate-library-v1", { version: 1, rates: [], assemblies: [], updatedAt: new Date().toISOString() });
  writeServerStore("heat-design-v1", { schemaVersion: 1, projects: [] });
}

export function wipeTrialCompanyData(): TrialWipeResult {
  if (!isTrialCompanyResetAllowed()) {
    return { ok: true, skipped: true, reason: "not-trial", deletedStores: [], deletedDirs: [], generation: 0 };
  }

  const { deleted } = wipeAllServerStoresExcept([...TRIAL_WIPE_KEEP_STORES]);
  const deletedDirs = wipeServerStoreDirectories(TRIAL_WIPE_DIRS);

  writeBlankOperationalStores();
  const generation = TRIAL_WIPE_GENERATION;
  writeServerStore<TrialWipeState>(TRIAL_WIPE_STORE, {
    generation,
    wipedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    deletedStores: deleted,
    deletedDirs,
    generation,
  };
}

export function maybeWipeTrialWorkspaceOnBoot(): TrialWipeResult | null {
  if (!isTrialCompanyResetAllowed()) return null;
  const state = loadServerStore<TrialWipeState>(TRIAL_WIPE_STORE, {});
  const current = Number(state.generation) || 0;
  if (current >= TRIAL_WIPE_GENERATION) {
    return { ok: true, skipped: true, reason: "already-wiped", deletedStores: [], deletedDirs: [], generation: current };
  }
  return wipeTrialCompanyData();
}
