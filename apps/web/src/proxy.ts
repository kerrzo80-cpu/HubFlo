import { NextResponse, type NextRequest } from "next/server";

import { employeeHeaderName, permissionHeaderName, roleHeaderName } from "@/lib/access";
import { getAuthUserForSession, isUserAuthenticationEnabled, nexaSessionCookie } from "@/lib/auth-store";
import { resolveTenantFromHost } from "@/lib/tenancy/resolve-tenant";
import { migrateLegacyStoresForEwg } from "@/lib/tenancy/tenant-server-store";
import { listMemberships, upsertMembership } from "@/lib/tenancy/tenant-store";
import { EWG_TENANT_ID, TENANT_ID_HEADER, TENANT_SLUG_HEADER } from "@/lib/tenancy/types";

const pilotPin = process.env.NEXA_PILOT_PIN;
const pilotUser = process.env.NEXA_PILOT_USER?.trim() || "nexa";
const pilotSessionCookie = "nexa_pilot_session";
const pilotSessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const publicPagePrefixes = ["/ai-first", "/heat-design"];
const publicAssetPrefixes = ["/app-icons/", "/brand/"];
const userAuthPublicPaths = new Set([
  "/api/auth/login",
  "/api/auth/me",
  "/api/health",
  "/api/tenant",
  "/api/postcode-lookup",
  "/ai-first",
  "/heat-design",
  "/nexa-ai-first.html",
  "/login",
]);
const publicAssetPaths = new Set([
  "/ewg-logo.png",
  "/apple-icon.png",
  "/icon.png",
  "/nexa-ai-first.html",
  "/manifest-core.json",
  "/manifest-estimator.json",
  "/manifest-field.json",
  "/manifest-takeoffs.json",
  "/estimator/apple-icon.png",
  "/estimator/icon.png",
  "/survey/apple-icon.png",
  "/survey/icon.png",
  "/takeoff/apple-icon.png",
  "/takeoff/icon.png",
]);

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

function expectedPilotSessionValue() {
  if (!pilotPin) return "";

  try {
    return btoa(`${pilotUser}:${pilotPin}`);
  } catch {
    return `${pilotUser}:${pilotPin}`;
  }
}

function requestHost(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("host") || request.nextUrl.host || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function withTenantHeaders(request: NextRequest, extra?: Headers) {
  const host = requestHost(request);
  const resolved = resolveTenantFromHost(host);
  const requestHeaders = new Headers(extra || request.headers);
  // Strip any client-supplied tenant headers — only proxy may set them.
  requestHeaders.delete(TENANT_ID_HEADER);
  requestHeaders.delete(TENANT_SLUG_HEADER);
  requestHeaders.delete("x-hubflo-tenant-id");

  if (!resolved) {
    return { ok: false as const, host, requestHeaders };
  }

  try {
    migrateLegacyStoresForEwg();
  } catch {
    // Best-effort on edge/cold start.
  }

  requestHeaders.set(TENANT_ID_HEADER, resolved.tenant.id);
  requestHeaders.set(TENANT_SLUG_HEADER, resolved.tenant.slug);
  requestHeaders.set("x-hubflo-tenant-id", resolved.tenant.id);
  return { ok: true as const, host, tenant: resolved.tenant, requestHeaders };
}

function ensureEwgMembershipForLegacyUsers(userId: string, role: string) {
  const memberships = listMemberships(EWG_TENANT_ID);
  if (memberships.some((item) => item.userId === userId)) return;
  // Bootstrap: existing users belong to EWG until invited elsewhere.
  try {
    upsertMembership({ tenantId: EWG_TENANT_ID, userId, role, status: "active" });
  } catch {
    // ignore
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const tenantGate = withTenantHeaders(request);
  if (!tenantGate.ok && pathname !== "/api/health") {
    // Allow platform marketing/root tooling without a company subdomain later;
    // for now unknown hosts are rejected except health.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: `Unknown company host: ${tenantGate.host || "(empty)"}` },
        { status: 404 },
      );
    }
  }

  if (pathname === "/api/health") {
    const headers = tenantGate.ok ? tenantGate.requestHeaders : new Headers(request.headers);
    return NextResponse.next({ request: { headers } });
  }

  if (
    publicAssetPaths.has(pathname) ||
    publicAssetPrefixes.some((prefix) => pathname.startsWith(prefix)) ||
    publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return NextResponse.next({
      request: { headers: tenantGate.ok ? tenantGate.requestHeaders : request.headers },
    });
  }

  if (isUserAuthenticationEnabled()) {
    if (
      userAuthPublicPaths.has(pathname) ||
      publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    ) {
      return NextResponse.next({
        request: { headers: tenantGate.ok ? tenantGate.requestHeaders : request.headers },
      });
    }
    const user = getAuthUserForSession(request.cookies.get(nexaSessionCookie)?.value);
    if (pathname === "/login") {
      if (!user) {
        return NextResponse.next({
          request: { headers: tenantGate.ok ? tenantGate.requestHeaders : request.headers },
        });
      }
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

    if (tenantGate.ok) {
      ensureEwgMembershipForLegacyUsers(user.id, user.role);
      const memberships = listMemberships(tenantGate.tenant.id);
      const allowed = memberships.some((item) => item.userId === user.id && item.status === "active");
      // During migration, Owner/Admin on EWG host is always allowed.
      const legacyOwnerBypass =
        tenantGate.tenant.id === EWG_TENANT_ID &&
        (user.role === "Owner/Admin" || user.role === "Manager");
      if (!allowed && !legacyOwnerBypass) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Your account is not a member of this company workspace." },
            { status: 403 },
          );
        }
        return new NextResponse("Your account is not a member of this company workspace.", {
          status: 403,
        });
      }
    }

    const requestHeaders = new Headers(tenantGate.ok ? tenantGate.requestHeaders : request.headers);
    requestHeaders.set(roleHeaderName, user.role);
    requestHeaders.set(employeeHeaderName, user.employeeId || user.id);
    requestHeaders.set(permissionHeaderName, JSON.stringify(user.permissions));
    requestHeaders.set("x-nexa-auth-user-id", user.id);
    requestHeaders.set("x-nexa-auth-user-name", user.name);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!pilotPin) {
    return NextResponse.next({
      request: { headers: tenantGate.ok ? tenantGate.requestHeaders : request.headers },
    });
  }

  const expectedPilotSession = expectedPilotSessionValue();
  if (request.cookies.get(pilotSessionCookie)?.value === expectedPilotSession) {
    return NextResponse.next({
      request: { headers: tenantGate.ok ? tenantGate.requestHeaders : request.headers },
    });
  }

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  if (credentials?.username === pilotUser && credentials.password === pilotPin) {
    const response = NextResponse.next({
      request: { headers: tenantGate.ok ? tenantGate.requestHeaders : request.headers },
    });
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
      { error: "NeXa pilot login required. Refresh the page and sign in again." },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="NeXa pilot", charset="UTF-8"',
        },
      },
    );
  }

  return new NextResponse("NeXa pilot login required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="NeXa pilot", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
