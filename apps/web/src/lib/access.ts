export type HubRole =
  | "Owner/Admin"
  | "Manager"
  | "Office"
  | "Engineer"
  | "Finance"
  | "Read-only";

export type AccessProfile = {
  /** Office Core shell (dashboard, leads, jobs register, setup, etc.). */
  showCore: boolean;
  /** Field app for site engineers / plumbers. */
  showField: boolean;
  /** Surveyor addon. */
  showSurveyor: boolean;
  /** Takeoff / Heat Design style estimating addons. */
  showTakeoff: boolean;
  showCustomers: boolean;
  showJobs: boolean;
  showQuotes: boolean;
  showAssets: boolean;
  showStock: boolean;
  showFinance: boolean;
  showSchedule: boolean;
  canCreateJob: boolean;
  canCreateQuote: boolean;
  canCreateLead: boolean;
  canEditJobs: boolean;
  canDeleteJobs: boolean;
  canRequestPurchase: boolean;
  canApprovePurchase: boolean;
  canCustomize: boolean;
  canEditInvoice: boolean;
};

export type AccessOverride = Partial<AccessProfile>;

export type Weekday =
  | "Mon"
  | "Tue"
  | "Wed"
  | "Thu"
  | "Fri"
  | "Sat"
  | "Sun";

export const weekDays: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type EmployeeLicense = {
  id: string;
  type: string;
  reference: string;
  expiresOn: string;
  status: string;
  attachmentFileName?: string;
  attachmentUploadedAt?: string;
};

export type EmployeeDocument = {
  id: string;
  label: string;
  fileName: string;
  uploadedAt: string;
};

export type EmployeeEmergencyContact = {
  id: string;
  name: string;
  relationship: string;
  phone: string;
};

export type EmployeeAvailability = Record<Weekday, { active: boolean; from: string; to: string }>;

export type EmployeeProfile = {
  email?: string;
  phone?: string;
  address?: string;
  payroll?: {
    hourlyRate?: number;
    overtimeRate?: number;
    niMultiplier?: number;
    pensionPercent?: number;
    dailyToolAllowance?: number;
  };
  employmentCostNote?: string;
  startDate?: string;
  roleLabel?: string;
  /** Hex colour used on the weekly Gantt / diary bars for this person. */
  ganttColor?: string;
  licenses?: EmployeeLicense[];
  documents?: EmployeeDocument[];
  emergencyContacts?: EmployeeEmergencyContact[];
  availability?: EmployeeAvailability;
  bankDetails?: {
    sortCode?: string;
    accountNumber?: string;
  };
};

export type EmployeeLogin = {
  username: string;
  password: string;
  enabled: boolean;
  lastLoginAt?: string;
};

const officeCoreOpen: Pick<
  AccessProfile,
  "showCore" | "showField" | "showSurveyor" | "showTakeoff"
> = {
  showCore: true,
  showField: true,
  showSurveyor: true,
  showTakeoff: true,
};

export const roleAccess: Record<HubRole, AccessProfile> = {
  "Owner/Admin": {
    ...officeCoreOpen,
    showCustomers: true,
    showJobs: true,
    showQuotes: true,
    showAssets: true,
    showStock: true,
    showFinance: true,
    showSchedule: true,
    canCreateJob: true,
    canCreateQuote: true,
    canCreateLead: true,
    canEditJobs: true,
    canDeleteJobs: true,
    canRequestPurchase: true,
    canApprovePurchase: true,
    canCustomize: true,
    canEditInvoice: true,
  },
  Manager: {
    ...officeCoreOpen,
    showCustomers: true,
    showJobs: true,
    showQuotes: true,
    showAssets: true,
    showStock: true,
    showFinance: true,
    showSchedule: true,
    canCreateJob: true,
    canCreateQuote: true,
    canCreateLead: true,
    canEditJobs: true,
    canDeleteJobs: true,
    canRequestPurchase: true,
    canApprovePurchase: true,
    canCustomize: true,
    canEditInvoice: true,
  },
  Office: {
    showCore: true,
    showField: false,
    showSurveyor: true,
    showTakeoff: true,
    showCustomers: true,
    showJobs: true,
    showQuotes: true,
    showAssets: false,
    showStock: true,
    showFinance: true,
    showSchedule: false,
    canCreateJob: true,
    canCreateQuote: true,
    canCreateLead: true,
    canEditJobs: true,
    canDeleteJobs: true,
    canRequestPurchase: true,
    canApprovePurchase: true,
    canCustomize: true,
    canEditInvoice: true,
  },
  /** Field-first: plumbers / site engineers get Field, not the office shell. */
  Engineer: {
    showCore: false,
    showField: true,
    showSurveyor: false,
    showTakeoff: false,
    showCustomers: false,
    showJobs: false,
    showQuotes: false,
    showAssets: false,
    showStock: false,
    showFinance: false,
    showSchedule: false,
    canCreateJob: false,
    canCreateQuote: false,
    canCreateLead: false,
    canEditJobs: false,
    canDeleteJobs: false,
    canRequestPurchase: false,
    canApprovePurchase: false,
    canCustomize: false,
    canEditInvoice: false,
  },
  Finance: {
    showCore: true,
    showField: false,
    showSurveyor: false,
    showTakeoff: false,
    showCustomers: true,
    showJobs: true,
    showQuotes: true,
    showAssets: false,
    showStock: false,
    showFinance: true,
    showSchedule: false,
    canCreateJob: false,
    canCreateQuote: true,
    canCreateLead: false,
    canEditJobs: false,
    canDeleteJobs: false,
    canRequestPurchase: true,
    canApprovePurchase: true,
    canCustomize: true,
    canEditInvoice: true,
  },
  "Read-only": {
    showCore: true,
    showField: false,
    showSurveyor: false,
    showTakeoff: false,
    showCustomers: true,
    showJobs: true,
    showQuotes: true,
    showAssets: true,
    showStock: true,
    showFinance: true,
    showSchedule: true,
    canCreateJob: false,
    canCreateQuote: false,
    canCreateLead: false,
    canEditJobs: false,
    canDeleteJobs: false,
    canRequestPurchase: false,
    canApprovePurchase: false,
    canCustomize: false,
    canEditInvoice: false,
  },
};

export type Employee = {
  id: string;
  name: string;
  role: HubRole;
  archived?: boolean;
  permissions: AccessOverride;
  profile?: EmployeeProfile;
  login?: EmployeeLogin;
};

export const roleChoices: HubRole[] = [
  "Owner/Admin",
  "Manager",
  "Office",
  "Engineer",
  "Finance",
  "Read-only",
];

export const accessProfileKeys = Object.keys(roleAccess["Owner/Admin"]) as Array<keyof AccessProfile>;

function sanitizeAccessOverride(value: Record<string, unknown>): AccessOverride {
  const parsed: AccessOverride = {};
  accessProfileKeys.forEach((key) => {
    const item = value[key];
    if (typeof item === "boolean") {
      parsed[key] = item;
    }
  });
  return parsed;
}

export function parsePermissionOverrides(value: string | null | undefined): AccessOverride | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return sanitizeAccessOverride(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Used when role is missing — never escalate to Owner/Admin. */
export const defaultDeniedRole: HubRole = "Read-only";

export function getAccessProfile(
  role: HubRole | null | undefined,
  overrides: AccessOverride | null | undefined = null,
): AccessProfile {
  const resolved = role && roleChoices.includes(role) ? role : defaultDeniedRole;
  if (!overrides) {
    return { ...roleAccess[resolved] };
  }
  return { ...roleAccess[resolved], ...overrides };
}

/** Persist the full effective profile so unticked boxes stay denied under any role merge. */
export function toStoredAccessProfile(
  role: HubRole | null | undefined,
  overrides: AccessOverride | null | undefined = null,
): AccessProfile {
  return getAccessProfile(role, overrides);
}

export function parseRole(value: string | null | undefined): HubRole | null {
  if (!value) return null;
  return roleChoices.includes(value as HubRole) ? (value as HubRole) : null;
}

export function getAccessProfileFromHeaders(headers: Headers): AccessProfile {
  const role = parseRole(headers.get(roleHeaderName));
  const overrides = parsePermissionOverrides(headers.get(permissionHeaderName));
  return getAccessProfile(role, overrides);
}

/** Office Core shell — dashboard, registers, setup. Field-only staff should be false. */
export function hasCoreOfficeAccess(access: AccessProfile): boolean {
  return Boolean(access.showCore);
}

export function hasFieldAppAccess(access: AccessProfile): boolean {
  return Boolean(access.showField);
}

/** Takeoff Studio PATCH/create — Office quotes or job editors (e.g. Chris marking drawings). */
export function canSaveTakeoff(access: AccessProfile): boolean {
  return Boolean(access.showTakeoff && (access.canCreateQuote || access.canEditJobs));
}

/** Core tenders BoQ edit — mirrors Heat Design push-to-tender gate. */
export function canEditTenders(access: AccessProfile): boolean {
  return Boolean(
    access.showCore &&
      (access.canCreateQuote || access.canEditJobs || access.showFinance || access.canCustomize),
  );
}

/** Push Takeoff BoQ onto a linked tender — needs takeoff save + tender edit rights. */
export function canPushTakeoffToTender(access: AccessProfile): boolean {
  return canSaveTakeoff(access) && canEditTenders(access);
}

const GANTT_FALLBACK_COLORS = [
  "#006eb8",
  "#2e8c7d",
  "#f79009",
  "#7a5af8",
  "#f04438",
  "#12b76a",
  "#2e90fa",
  "#c11574",
  "#9b7b32",
  "#175cd3",
];

export function normalizeGanttColor(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return null;
  return raw.toLowerCase();
}

/** Prefer the employee card colour; otherwise a stable name hash. */
export function resolveEmployeeGanttColor(name: string, profileColor?: string | null): string {
  const normalized = normalizeGanttColor(profileColor);
  if (normalized) return normalized;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return GANTT_FALLBACK_COLORS[hash % GANTT_FALLBACK_COLORS.length] ?? "#006eb8";
}

export const roleHeaderName = "x-hubflo-role";
export const employeeHeaderName = "x-hubflo-employee-id";
export const permissionHeaderName = "x-hubflo-permissions";
