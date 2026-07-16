import { NextResponse, type NextRequest } from "next/server";

import { employeeHeaderName, permissionHeaderName, roleHeaderName } from "@/lib/access";
import { getAuthUserForSession, isUserAuthenticationEnabled, nexaSessionCookie } from "@/lib/auth-store";

const pilotPin = process.env.NEXA_PILOT_PIN;
const pilotUser = process.env.NEXA_PILOT_USER ?? "nexa";
const pilotSessionCookie = "nexa_pilot_session";
const pilotSessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const publicAssetPrefixes = ["/app-icons/"];
const userAuthPublicPaths = new Set(["/api/auth/login", "/api/health"]);
const publicAssetPaths = new Set([
  "/ewg-logo.png",
  "/apple-icon.png",
  "/icon.png",
  "/manifest-core.json",
  "/manifest-estimator.json",
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/api/health") return NextResponse.next();
  if (publicAssetPaths.has(pathname) || publicAssetPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (isUserAuthenticationEnabled()) {
    if (userAuthPublicPaths.has(pathname)) return NextResponse.next();
    const user = getAuthUserForSession(request.cookies.get(nexaSessionCookie)?.value);
    if (pathname === "/login") {
      if (!user) return NextResponse.next();
      const workspaceUrl = request.nextUrl.clone();
      workspaceUrl.pathname = "/";
      workspaceUrl.search = "";
      return NextResponse.redirect(workspaceUrl);
    }
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(roleHeaderName, user.role);
    requestHeaders.set(employeeHeaderName, user.employeeId || user.id);
    requestHeaders.set(permissionHeaderName, JSON.stringify(user.permissions));
    requestHeaders.set("x-nexa-auth-user-id", user.id);
    requestHeaders.set("x-nexa-auth-user-name", user.name);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!pilotPin) return NextResponse.next();

  const expectedPilotSession = expectedPilotSessionValue();
  if (request.cookies.get(pilotSessionCookie)?.value === expectedPilotSession) {
    return NextResponse.next();
  }

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  if (credentials?.username === pilotUser && credentials.password === pilotPin) {
    const response = NextResponse.next();
    response.cookies.set(pilotSessionCookie, expectedPilotSession, {
      httpOnly: true,
      maxAge: pilotSessionMaxAgeSeconds,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
    return response;
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
