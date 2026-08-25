export type HubRole =
  | "Owner/Admin"
  | "Manager"
  | "Office"
  | "Engineer"
  | "Finance"
  | "Read-only";

export type AccessProfile = {
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

export const roleAccess: Record<HubRole, AccessProfile> = {
  "Owner/Admin": {
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
  Engineer: {
    showCustomers: true,
    showJobs: true,
    showQuotes: false,
    showAssets: false,
    showStock: false,
    showFinance: false,
    showSchedule: true,
    canCreateJob: true,
    canCreateQuote: false,
    canCreateLead: false,
    canEditJobs: true,
    canDeleteJobs: false,
    canRequestPurchase: true,
    canApprovePurchase: false,
    canCustomize: false,
    canEditInvoice: false,
  },
  Finance: {
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

function sanitizeAccessOverride(value: Record<string, unknown>): AccessOverride {
  const parsed: AccessOverride = {};
  (Object.keys(roleAccess["Owner/Admin"]) as Array<keyof AccessProfile>).forEach((key) => {
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

/** Deny-all profile used when role is missing under strict (users) auth. */
export const denyAccessProfile: AccessProfile = {
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
};

function isStrictAccessMode() {
  return process.env.NEXA_AUTH_MODE?.trim().toLowerCase() === "users";
}

export function getAccessProfile(
  role: HubRole | null | undefined,
  overrides: AccessOverride | null | undefined = null,
): AccessProfile {
  // Production users-mode: never elevate a missing role to Owner/Admin.
  // Local/pilot without users auth keeps the historical Owner/Admin default for DX.
  if (!role) {
    if (isStrictAccessMode()) {
      return overrides ? { ...denyAccessProfile, ...overrides } : denyAccessProfile;
    }
    return overrides
      ? { ...roleAccess["Owner/Admin"], ...overrides }
      : roleAccess["Owner/Admin"];
  }
  if (!overrides) {
    return roleAccess[role];
  }
  return { ...roleAccess[role], ...overrides };
}

export function parseRole(value: string | null | undefined): HubRole | null {
  if (!value) return null;
  return roleChoices.includes(value as HubRole) ? (value as HubRole) : null;
}

export function getAccessProfileFromHeaders(headers: Headers): AccessProfile {
  const role = parseRole(headers.get(roleHeaderName));
  const overrides = parsePermissionOverrides(headers.get(permissionHeaderName));
  // Under users auth the proxy must inject the session role. If it is absent,
  // treat the request as unprivileged even if the client sent permission JSON.
  if (isStrictAccessMode() && !role && !headers.get("x-nexa-auth-user-id")) {
    return denyAccessProfile;
  }
  return getAccessProfile(role, overrides);
}

export const roleHeaderName = "x-hubflo-role";
export const employeeHeaderName = "x-hubflo-employee-id";
export const permissionHeaderName = "x-hubflo-permissions";
