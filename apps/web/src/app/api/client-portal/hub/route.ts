import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth-request";
import { isUserAuthenticationEnabled } from "@/lib/auth-store";
import { createClientHubToken } from "@/lib/client-portal-hub";

type CreateClientHubPayload = {
  customerName?: string;
  clientId?: string;
};

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

function isPilotAuthorized(request: Request) {
  const pilotPin = process.env.NEXA_PILOT_PIN;
  if (!pilotPin) return true;

  const pilotUser = process.env.NEXA_PILOT_USER?.trim() || "nexa";
  const expectedSession = Buffer.from(`${pilotUser}:${pilotPin}`).toString("base64");
  if (cookieValue(request, "nexa_pilot_session") === expectedSession) return true;

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return false;

  try {
    return Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8") === `${pilotUser}:${pilotPin}`;
  } catch {
    return false;
  }
}

function isAuthorized(request: Request) {
  if (isUserAuthenticationEnabled()) return Boolean(getAuthenticatedUser(request));
  return isPilotAuthorized(request);
}

function publicOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as CreateClientHubPayload | null;
  const customerName = payload?.customerName?.trim();
  if (!customerName) {
    return NextResponse.json({ error: "customerName is required" }, { status: 400 });
  }

  const token = createClientHubToken({
    customerName,
    clientId: payload?.clientId?.trim() || undefined,
  });
  const url = new URL(`/client/hub/${token}`, publicOrigin(request)).toString();

  return NextResponse.json({ token, url });
}
