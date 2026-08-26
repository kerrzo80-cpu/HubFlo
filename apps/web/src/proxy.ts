import { NextResponse, type NextRequest } from "next/server";

import {
  employeeHeaderName,
  getAccessProfile,
  hasCoreOfficeAccess,
  hasFieldAppAccess,
  permissionHeaderName,
  roleHeaderName,
} from "@/lib/access";
import { getAuthUserForSession, isUserAuthenticationEnabled, nexaSessionCookie } from "@/lib/auth-store";
import { isTrialAccessExpired, isTrialExpiredAllowedPath, TRIAL_ENDED_PATH } from "@/lib/trial-licence";

const pilotPin = process.env.NEXA_PILOT_PIN;
const pilotUser = process.env.NEXA_PILOT_USER?.trim() || "nexa";
const pilotSessionCookie = "nexa_pilot_session";
const pilotSessionMaxAgeSeconds = 60 * 60 * 24 * 30;
/** Shared office PIN gate has no per-user role — stamp Owner/Admin explicitly (never leave blank). */
const pilotGateRole = "Owner/Admin";
const publicPagePrefixes = ["/heat-design", "/client", "/nexa", "/early-access"];
const publicAssetPrefixes = ["/app-icons/", "/brand/", "/api/manifest/"];
const publicApiPrefixes = [
  "/api/quote-portal",
  "/api/variation-portal",
  "/api/invoice-portal",
  "/api/client-portal",
  "/api/integrations/sumup/webhook",
  "/api/integrations/xero/callback",
];
const userAuthPublicPaths = new Set([
  "/api/auth/login",
  "/api/auth/me",
  "/api/blake/drive-handoff/redeem",
  "/api/health",
  "/api/health/smoke",
  "/api/branding",
  "/api/trial-licence",
  "/api/postcode-lookup",
  "/heat-design",
  "/nexa",
  "/early-access",
  "/trial-ended",
]);
/**
 * Render cron endpoints authenticate with shared secrets inside the route
 * (x-nexa-backup-secret / x-nexa-import-tick-secret). They must bypass session
 * gates in this proxy or cron gets 401 Unauthenticated before the handler runs.
 */
export const secretAuthCronPaths = new Set([
  "/api/office-backup/cron",
  "/api/integrations/simpro/sync/cron",
  "/api/integrations/xero/payments/cron",
  "/api/integrations/simpro/import/tick",
  "/api/integrations/simpro/webhook",
  "/api/integrations/email/inbound",
  "/api/integrations/intake",
  "/api/whatsapp/webhook",
  "/api/reports/board-pack/cron",
  "/api/ops/postgres-reconcile",
]);
const publicAssetPaths = new Set([
  "/ewg-logo.png",
  "/ewg-mark.png",
  "/apple-icon.png",
  "/apple-icon",
  "/icon.png",
  "/icon",
  "/favicon.ico",
  "/sw-field.js",
  "/field/sw.js",
  "/manifest-core.json",
  "/manifest-estimator.json",
  "/manifest-field.json",
  "/manifest-takeoffs.json",
]);

function isPublicBrandingGet(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = request.nextUrl;
  return (
    pathname === "/api/branding" ||
    pathname === "/api/branding/favicon" ||
    pathname.startsWith("/api/branding/assets/")
  );
}

function parseBasicAuth(value: string | null) {
  if (!value?.startsWith("Basic ")) return null;

  try {
    const decoded = atob(value.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function parseBearerAuth(value: string | null) {
  return value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function expectedPilotSessionValue() {
  if (!pilotPin) return "";

  try {
    return btoa(`${pilotUser}:${pilotPin}`);
  } catch {
    return `${pilotUser}:${pilotPin}`;
  }
}

function withRoleHeaders(request: NextRequest, role: string, employeeId = "pilot") {
  const requestHeaders = new Headers(request.headers);
  // Overwrite spoofable client role headers with session-derived values.
  requestHeaders.set(roleHeaderName, role);
  requestHeaders.set(employeeHeaderName, employeeId);
  // Always reset permissions too — keeping a Field-only client profile would deny
  // Core APIs even after we stamp an office pilot role.
  requestHeaders.set(permissionHeaderName, "{}");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/api/health" || pathname === "/api/health/smoke") return NextResponse.next();
  if (secretAuthCronPaths.has(pathname)) return NextResponse.next();
  if (isTrialAccessExpired()) {
    if (isTrialExpiredAllowedPath(pathname)) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "This trial has ended.", trialExpired: true },
        { status: 403 },
      );
    }
    const ended = request.nextUrl.clone();
    ended.pathname = TRIAL_ENDED_PATH;
    ended.search = "";
    return NextResponse.redirect(ended);
  }
  if (isPublicBrandingGet(request)) return NextResponse.next();
  if (
    publicAssetPaths.has(pathname) ||
    publicAssetPrefixes.some((prefix) => pathname.startsWith(prefix)) ||
    publicApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return NextResponse.next();
  }

  if (isUserAuthenticationEnabled()) {
    if (
      userAuthPublicPaths.has(pathname) ||
      publicApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
      publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    ) {
      return NextResponse.next();
    }
    const sessionToken = parseBearerAuth(request.headers.get("authorization")) || request.cookies.get(nexaSessionCookie)?.value;
    const user = getAuthUserForSession(sessionToken);
    if (pathname === "/login") {
      if (!user) return NextResponse.next();
      // Force password-change accounts to stay on /login until they set a new password.
      if (user.mustChangePassword) return NextResponse.next();
      const workspaceUrl = request.nextUrl.clone();
      workspaceUrl.pathname = "/";
      workspaceUrl.search = "";
      return NextResponse.redirect(workspaceUrl);
    }
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            error: pathname.includes("/daywork")
              ? "Unauthenticated — sign in at /login before Field Daywork Save and finish"
              : "Unauthenticated",
          },
          { status: 401 },
        );
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    if (
      user.mustChangePassword &&
      pathname !== "/api/auth/change-password" &&
      pathname !== "/api/auth/logout" &&
      pathname !== "/api/auth/me"
    ) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Password change required before continuing.", mustChangePassword: true },
          { status: 403 },
        );
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("change", "1");
      return NextResponse.redirect(loginUrl);
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(roleHeaderName, user.role);
    requestHeaders.set(employeeHeaderName, user.employeeId || user.id);
    requestHeaders.set(permissionHeaderName, JSON.stringify(user.permissions));
    requestHeaders.set("x-nexa-auth-user-id", user.id);
    requestHeaders.set("x-nexa-auth-user-name", user.name);

    const access = getAccessProfile(user.role, user.permissions);
    const fieldOnly = hasFieldAppAccess(access) && !hasCoreOfficeAccess(access);
    if (fieldOnly) {
      const allowedFieldPrefixes = [
        "/field",
        "/api/field",
        "/api/auth",
        "/api/health",
        "/api/branding",
        "/api/manifest",
        "/login",
      ];
      const allowed =
        allowedFieldPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
        publicAssetPaths.has(pathname) ||
        publicAssetPrefixes.some((prefix) => pathname.startsWith(prefix));
      if (!allowed) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "This account is Field-only. Open /field — Core office modules are disabled." },
            { status: 403 },
          );
        }
        const fieldUrl = request.nextUrl.clone();
        fieldUrl.pathname = "/field";
        fieldUrl.search = "";
        return NextResponse.redirect(fieldUrl);
      }
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Open local / no pin: still stamp a role so APIs never inherit a blank/spoofed header as Owner.
  if (!pilotPin) {
    return withRoleHeaders(request, pilotGateRole);
  }

  const expectedPilotSession = expectedPilotSessionValue();
  if (request.cookies.get(pilotSessionCookie)?.value === expectedPilotSession) {
    return withRoleHeaders(request, pilotGateRole);
  }

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  if (credentials?.username === pilotUser && credentials.password === pilotPin) {
    const response = withRoleHeaders(request, pilotGateRole);
    response.cookies.set(pilotSessionCookie, expectedPilotSession, {
      httpOnly: true,
      maxAge: pilotSessionMaxAgeSeconds,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Blake pilot login required. Refresh the page and sign in again." },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Blake pilot", charset="UTF-8"',
        },
      },
    );
  }

  return new NextResponse("Blake pilot login required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Blake pilot", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
