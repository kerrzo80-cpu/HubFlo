/**
 * Core module URL map — top-level homeView ↔ App Router path.
 * Nested record views stay under their parent module path (Phase 1).
 */

export type CoreModulePath =
  | "/"
  | "/leads"
  | "/quotes"
  | "/jobs"
  | "/schedule"
  | "/invoices"
  | "/purchase-orders"
  | "/stock"
  | "/recurring"
  | "/reports"
  | "/setup"
  | "/xero"
  | "/people"
  | "/profile";

/** HomeView strings used by CoreApp (kept as string to avoid circular imports). */
export type CoreHomeView =
  | "dashboard"
  | "leads"
  | "lead-create"
  | "lead-record"
  | "quotes"
  | "quote-create"
  | "schedule"
  | "settings"
  | "addons"
  | "profile"
  | "employees"
  | "employee-card"
  | "clients"
  | "client-record"
  | "directory-manager"
  | "quote-record"
  | "jobs"
  | "job-create"
  | "purchase-orders"
  | "purchase-order-record"
  | "stock"
  | "recurring"
  | "reports"
  | "invoices"
  | "invoice-create"
  | "invoice-record"
  | "xero"
  | "job-record"
  | "quote-cost-centre-record"
  | "cost-centre-record";

const PATH_TO_HOME: Record<CoreModulePath, CoreHomeView> = {
  "/": "dashboard",
  "/leads": "leads",
  "/quotes": "quotes",
  "/jobs": "jobs",
  "/schedule": "schedule",
  "/invoices": "invoices",
  "/purchase-orders": "purchase-orders",
  "/stock": "stock",
  "/recurring": "recurring",
  "/reports": "reports",
  "/setup": "settings",
  "/xero": "xero",
  "/people": "employees",
  "/profile": "profile",
};

export const CORE_MODULE_PATHS: CoreModulePath[] = Object.keys(PATH_TO_HOME) as CoreModulePath[];

export function modulePathForHomeView(view: string): CoreModulePath {
  switch (view) {
    case "dashboard":
      return "/";
    case "leads":
    case "lead-create":
    case "lead-record":
      return "/leads";
    case "quotes":
    case "quote-create":
    case "quote-record":
    case "quote-cost-centre-record":
      return "/quotes";
    case "jobs":
    case "job-create":
    case "job-record":
    case "cost-centre-record":
      return "/jobs";
    case "schedule":
      return "/schedule";
    case "invoices":
    case "invoice-create":
    case "invoice-record":
      return "/invoices";
    case "purchase-orders":
    case "purchase-order-record":
      return "/purchase-orders";
    case "stock":
      return "/stock";
    case "recurring":
      return "/recurring";
    case "reports":
      return "/reports";
    case "settings":
    case "addons":
      return "/setup";
    case "xero":
      return "/xero";
    case "employees":
    case "employee-card":
    case "clients":
    case "client-record":
    case "directory-manager":
      return "/people";
    case "profile":
      return "/profile";
    default:
      return "/";
  }
}

export function homeViewForPath(pathname: string): CoreHomeView | null {
  const normalized = normalizeCorePath(pathname);
  if (!normalized) return null;
  return PATH_TO_HOME[normalized] ?? null;
}

export function normalizeCorePath(pathname: string): CoreModulePath | null {
  if (!pathname) return null;
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  if (clean === "/" || clean === "") return "/";
  const match = CORE_MODULE_PATHS.find((path) => path !== "/" && clean === path);
  return match ?? null;
}

export function isCoreModulePath(pathname: string): boolean {
  return normalizeCorePath(pathname) !== null;
}
