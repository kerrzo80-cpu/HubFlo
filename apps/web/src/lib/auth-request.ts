import { getAuthUserForSession, nexaSessionCookie } from "@/lib/auth-store";

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

export function getSessionTokenFromRequest(request: Request) {
  return cookieValue(request, nexaSessionCookie);
}

export function getAuthenticatedUser(request: Request) {
  return getAuthUserForSession(getSessionTokenFromRequest(request));
}
