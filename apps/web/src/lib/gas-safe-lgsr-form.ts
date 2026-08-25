import type { GasServiceRecord } from "@/lib/engineer-flow";
import { toUkDateDisplay } from "@/lib/uk-date";

/** Landlord Gas Safety Record (CP12-style) — Ayla form shaped from simPRO cost-centre gas cert practice. */
export type GasSafeLgsrField = {
  key: string;
  label: string;
  section: "Property" | "Appliance" | "Safety checks" | "Defects" | "Certification";
  source: keyof GasServiceRecord | "customer" | "site" | "engineer" | "jobRef" | "inspectionDate" | "applianceType";
};

export const GAS_SAFE_LGSR_FIELDS: GasSafeLgsrField[] = [
  { key: "customer", label: "Landlord / customer", section: "Property", source: "customer" },
  { key: "site", label: "Address of premises", section: "Property", source: "site" },
  { key: "jobRef", label: "Job / certificate reference", section: "Property", source: "jobRef" },
  { key: "inspectionDate", label: "Date of check", section: "Property", source: "inspectionDate" },
  { key: "applianceType", label: "Appliance type", section: "Appliance", source: "applianceType" },
  { key: "location", label: "Appliance location", section: "Appliance", source: "location" },
  { key: "makeModel", label: "Make / model", section: "Appliance", source: "makeModel" },
  { key: "serialNumber", label: "Serial number", section: "Appliance", source: "serialNumber" },
  { key: "appliancePhoto", label: "Appliance / data plate photo", section: "Appliance", source: "appliancePhoto" },
  { key: "flueVentilationOk", label: "Flue & ventilation satisfactory", section: "Safety checks", source: "flueVentilationOk" },
  { key: "visualConditionOk", label: "Visual condition of appliance & flue satisfactory", section: "Safety checks", source: "visualConditionOk" },
  { key: "safetyDevicesOk", label: "Safety devices working correctly", section: "Safety checks", source: "safetyDevicesOk" },
  { key: "operatingPressure", label: "Operating pressure / heat input", section: "Safety checks", source: "operatingPressure" },
  { key: "coReading", label: "CO reading (ppm)", section: "Safety checks", source: "coReading" },
  { key: "combustionRatio", label: "CO / CO₂ combustion ratio", section: "Safety checks", source: "combustionRatio" },
  { key: "applianceSafeToUse", label: "Appliance safe to use", section: "Safety checks", source: "applianceSafeToUse" },
  { key: "defects", label: "Defects identified / remedial action", section: "Defects", source: "defects" },
  { key: "nextServiceDate", label: "Next safety check due", section: "Certification", source: "nextServiceDate" },
  { key: "engineer", label: "Gas Safe registered engineer", section: "Certification", source: "engineer" },
  { key: "gasSafeLicenceNumber", label: "Gas Safe licence / ID card no.", section: "Certification", source: "gasSafeLicenceNumber" },
  { key: "customerSignature", label: "Received by (landlord / tenant)", section: "Certification", source: "customerSignature" },
];

export type GasSafeCertificateContext = {
  customer: string;
  site: string;
  engineer: string;
  jobRef: string;
  inspectionDate?: string;
  applianceType?: string;
  record: GasServiceRecord | null;
};

function formatBool(value?: boolean) {
  if (value === true) return "Yes — satisfactory";
  if (value === false) return "No";
  return "";
}

export function resolveGasSafeFieldValue(
  field: GasSafeLgsrField,
  context: GasSafeCertificateContext,
): string {
  const record = context.record;
  switch (field.source) {
    case "customer":
      return context.customer;
    case "site":
      return context.site;
    case "engineer":
      return context.engineer;
    case "jobRef":
      return context.jobRef;
    case "inspectionDate":
      return toUkDateDisplay(context.inspectionDate || record?.completedAt?.slice(0, 10) || "");
    case "applianceType":
      return context.applianceType || "Central heating boiler";
    case "flueVentilationOk":
      return formatBool(record?.flueVentilationOk);
    case "visualConditionOk":
      return formatBool(record?.visualConditionOk);
    case "safetyDevicesOk":
      return formatBool(record?.safetyDevicesOk);
    case "applianceSafeToUse":
      return formatBool(record?.applianceSafeToUse);
    case "location":
      return record?.location || "";
    case "makeModel":
      return record?.makeModel || "";
    case "serialNumber":
      return record?.serialNumber || "";
    case "appliancePhoto":
      return record?.appliancePhoto || "";
    case "operatingPressure":
      return record?.operatingPressure || "";
    case "coReading":
      return record?.coReading ? `${record.coReading} ppm` : "";
    case "combustionRatio":
      return record?.combustionRatio || "";
    case "defects":
      return record?.defects || "";
    case "nextServiceDate":
      return toUkDateDisplay(record?.nextServiceDate) || "";
    case "gasSafeLicenceNumber":
      return record?.gasSafeLicenceNumber || "";
    case "customerSignature":
      return record?.customerSignature || "";
    default:
      return "";
  }
}

export function gasSafeCertificateSections(context: GasSafeCertificateContext) {
  const sections = ["Property", "Appliance", "Safety checks", "Defects", "Certification"] as const;
  return sections.map((section) => ({
    section,
    rows: GAS_SAFE_LGSR_FIELDS.filter((field) => field.section === section).map((field) => ({
      key: field.key,
      label: field.label,
      value: resolveGasSafeFieldValue(field, context).trim() || "—",
      filled: Boolean(resolveGasSafeFieldValue(field, context).trim()),
    })),
  }));
}
