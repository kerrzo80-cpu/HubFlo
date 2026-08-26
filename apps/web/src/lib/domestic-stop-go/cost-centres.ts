import type { DomesticCostCentre } from "@/lib/domestic-stop-go/types";
import { DOMESTIC_TENANT_ID } from "@/lib/domestic-stop-go/types";

export const DOMESTIC_COST_CENTRE_CATALOGUE: DomesticCostCentre[] = [
  {
    id: "cc-sys-dom-gas-boiler-install",
    tenantId: DOMESTIC_TENANT_ID,
    stableCode: "DOM_GAS_BOILER_INSTALL",
    displayName: "Gas Boiler Installation & Commissioning",
    propertyScope: "domestic",
    workflowMode: "mandatory_stop_go",
    active: true,
    recordTitle: "Gas Boiler Installation & Commissioning Record",
  },
  {
    id: "cc-sys-dom-gas-boiler-service",
    tenantId: DOMESTIC_TENANT_ID,
    stableCode: "DOM_GAS_BOILER_SERVICE",
    displayName: "Gas Boiler Service",
    propertyScope: "domestic",
    workflowMode: "mandatory_stop_go",
    active: true,
    recordTitle: "Gas Boiler Service Record",
  },
  {
    id: "cc-sys-dom-gas-landlord-safety",
    tenantId: DOMESTIC_TENANT_ID,
    stableCode: "DOM_GAS_LANDLORD_SAFETY",
    displayName: "Landlord Gas Safety Record",
    propertyScope: "domestic",
    workflowMode: "mandatory_stop_go",
    active: true,
    recordTitle: "Landlord Gas Safety Record",
  },
  {
    id: "cc-sys-dom-gas-unsafe",
    tenantId: DOMESTIC_TENANT_ID,
    stableCode: "DOM_GAS_UNSAFE",
    displayName: "Gas Warning / Unsafe Situation Record",
    propertyScope: "domestic",
    workflowMode: "mandatory_stop_go",
    active: true,
    recordTitle: "Gas Warning / Unsafe Situation Record",
  },
  {
    id: "cc-sys-dom-gas-repair",
    tenantId: DOMESTIC_TENANT_ID,
    stableCode: "DOM_GAS_REPAIR",
    displayName: "Gas Repair and Breakdown",
    propertyScope: "domestic",
    workflowMode: "mandatory_stop_go",
    active: true,
    recordTitle: "Gas Repair and Breakdown Record",
  },
  {
    id: "cc-sys-dom-oil-boiler-install",
    tenantId: DOMESTIC_TENANT_ID,
    stableCode: "DOM_OIL_BOILER_INSTALL",
    displayName: "Oil Boiler Installation & Commissioning",
    propertyScope: "domestic",
    workflowMode: "mandatory_stop_go",
    active: true,
    recordTitle: "Oil Boiler Installation & Commissioning Record",
  },
  {
    id: "cc-sys-dom-oil-service-tank",
    tenantId: DOMESTIC_TENANT_ID,
    stableCode: "DOM_OIL_SERVICE_TANK",
    displayName: "Oil Boiler Service and Tank Inspection",
    propertyScope: "domestic",
    workflowMode: "mandatory_stop_go",
    active: true,
    recordTitle: "Oil Boiler Service and Tank Inspection Record",
  },
];

const DISPLAY_ALIASES: Record<string, string> = {
  "gas boiler installation": "DOM_GAS_BOILER_INSTALL",
  "gas boiler installation & commissioning": "DOM_GAS_BOILER_INSTALL",
  "gas boiler service": "DOM_GAS_BOILER_SERVICE",
  "landlord gas safety record": "DOM_GAS_LANDLORD_SAFETY",
  "landlord gas safety": "DOM_GAS_LANDLORD_SAFETY",
  "gas warning / unsafe situation record": "DOM_GAS_UNSAFE",
  "gas warning": "DOM_GAS_UNSAFE",
  "unsafe situation": "DOM_GAS_UNSAFE",
  "gas repair and breakdown": "DOM_GAS_REPAIR",
  "oil boiler installation & commissioning": "DOM_OIL_BOILER_INSTALL",
  "oil boiler installation": "DOM_OIL_BOILER_INSTALL",
  "oil boiler service and tank inspection": "DOM_OIL_SERVICE_TANK",
  "oil boiler service": "DOM_OIL_SERVICE_TANK",
};

export function displayNamesForDomesticStopGo() {
  return DOMESTIC_COST_CENTRE_CATALOGUE.map((item) => item.displayName);
}

export function findDomesticCostCentre(codeOrName?: string | null) {
  const raw = String(codeOrName || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const byCode = DOMESTIC_COST_CENTRE_CATALOGUE.find((item) => item.stableCode === upper || item.id === raw);
  if (byCode) return byCode;
  const byName = DOMESTIC_COST_CENTRE_CATALOGUE.find(
    (item) => item.displayName.toLowerCase() === raw.toLowerCase(),
  );
  if (byName) return byName;
  const alias = DISPLAY_ALIASES[raw.toLowerCase()];
  return alias ? DOMESTIC_COST_CENTRE_CATALOGUE.find((item) => item.stableCode === alias) ?? null : null;
}

export function isDomesticStopGoCostCentre(codeOrName?: string | null) {
  return Boolean(findDomesticCostCentre(codeOrName));
}
