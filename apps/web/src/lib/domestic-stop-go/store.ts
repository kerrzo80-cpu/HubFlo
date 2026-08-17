import { randomUUID } from "node:crypto";

import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { DOMESTIC_COST_CENTRE_CATALOGUE } from "@/lib/domestic-stop-go/cost-centres";
import {
  DOMESTIC_STOP_GO_STORE,
  DOMESTIC_TENANT_ID,
  type DomesticStopGoStore,
  type TenantStopGoSettings,
} from "@/lib/domestic-stop-go/types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const DEFAULT_GAS_CLASSIFICATIONS = [
  { id: "id", scheme: "gas" as const, label: "Immediately Dangerous", active: true },
  { id: "ar", scheme: "gas" as const, label: "At Risk", active: true },
  { id: "ncs", scheme: "gas" as const, label: "Not to Current Standards", active: true },
];

export const DEFAULT_OIL_CLASSIFICATIONS = [
  { id: "oil_fire", scheme: "oil" as const, label: "Fire risk", active: true },
  { id: "oil_pollution", scheme: "oil" as const, label: "Pollution / environmental risk", active: true },
  { id: "oil_leak", scheme: "oil" as const, label: "Oil leak", active: true },
  { id: "oil_unsafe_flue", scheme: "oil" as const, label: "Unsafe flue / ventilation", active: true },
];

export function defaultSettings(): TenantStopGoSettings {
  return {
    tenantId: DOMESTIC_TENANT_ID,
    recordPrefix: "NEXA-WR",
    nextRecordNumber: 1001,
    photoEvidenceOnPdf: true,
    customerPdfVisible: false,
    unsafeClassifications: DEFAULT_GAS_CLASSIFICATIONS,
    oilClassifications: DEFAULT_OIL_CLASSIFICATIONS,
  };
}

function emptyStore(): DomesticStopGoStore {
  return {
    tenantId: DOMESTIC_TENANT_ID,
    costCentres: clone(DOMESTIC_COST_CENTRE_CATALOGUE),
    settings: defaultSettings(),
    competencies: [
      {
        id: "comp-chris-gas-safe",
        employeeId: "eng-chris",
        scheme: "Gas Safe",
        category: "domestic_gas",
        registrationNumber: "123456789012",
        validFrom: "2024-01-01",
        expiresAt: "2028-12-31",
        active: true,
      },
      {
        id: "comp-chris-oftec",
        employeeId: "eng-chris",
        scheme: "OFTEC",
        category: "oil",
        registrationNumber: "OFTEC-TRIAL-001",
        validFrom: "2024-01-01",
        expiresAt: "2028-12-31",
        active: true,
      },
    ],
    runs: [],
    answers: [],
    evidence: [],
    signatures: [],
    records: [],
    audit: [],
    updatedAt: new Date().toISOString(),
  };
}

const store: DomesticStopGoStore = loadServerStore(DOMESTIC_STOP_GO_STORE, emptyStore());

function persist() {
  store.updatedAt = new Date().toISOString();
  writeServerStore(DOMESTIC_STOP_GO_STORE, store);
}

export function getDomesticStopGoStore() {
  return store;
}

export function saveDomesticStopGoStore() {
  persist();
  return store;
}

export function newId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function assertTenant(tenantId?: string | null) {
  const resolved = tenantId || DOMESTIC_TENANT_ID;
  if (resolved !== store.tenantId) {
    throw new Error("Tenant isolation: this record is not in the current workspace.");
  }
  return resolved;
}

export function seedDomesticCostCentresIdempotent() {
  const byCode = new Map(store.costCentres.map((item) => [item.stableCode, item]));
  let changed = false;
  for (const catalogue of DOMESTIC_COST_CENTRE_CATALOGUE) {
    const existing = byCode.get(catalogue.stableCode);
    if (!existing) {
      store.costCentres.push(clone(catalogue));
      changed = true;
      continue;
    }
    existing.recordTitle = catalogue.recordTitle;
    existing.propertyScope = "domestic";
    existing.workflowMode = "mandatory_stop_go";
    existing.displayName = existing.displayName || catalogue.displayName;
    existing.tenantId = existing.tenantId || DOMESTIC_TENANT_ID;
  }
  if (!store.settings) store.settings = defaultSettings();
  if (!store.settings.unsafeClassifications?.length) {
    store.settings.unsafeClassifications = DEFAULT_GAS_CLASSIFICATIONS;
    changed = true;
  }
  if (!store.settings.oilClassifications?.length) {
    store.settings.oilClassifications = DEFAULT_OIL_CLASSIFICATIONS;
    changed = true;
  }
  if (!store.competencies) store.competencies = [];
  for (const seeded of emptyStore().competencies) {
    const exists = store.competencies.some(
      (item) => item.id === seeded.id || (item.employeeId === seeded.employeeId && item.scheme === seeded.scheme),
    );
    if (!exists) {
      store.competencies.push(seeded);
      changed = true;
    }
  }
  if (changed) persist();
  return clone(store.costCentres);
}
