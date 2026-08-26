import { NextResponse } from "next/server";

import { createAdditionalUserSession, nexaSessionCookie, nexaSessionMaxAgeSeconds } from "@/lib/auth-store";
import { consumeBlakeDriveHandoff } from "@/lib/blake-drive-handoff";

export const runtime = "nodejs";

function failed(request: Request, reason: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("next", "/blake/drive");
  url.searchParams.set("handoff", reason);
  return NextResponse.redirect(url, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim() || "";
  const handoff = consumeBlakeDriveHandoff(code);
  if (!handoff) return failed(request, "expired");

  try {
    const session = createAdditionalUserSession(handoff.userId);
    const destination = new URL("/blake/drive", request.url);
    const response = NextResponse.redirect(destination, {
      status: 303,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
    response.cookies.set(nexaSessionCookie, session.token, {
      httpOnly: true,
      maxAge: nexaSessionMaxAgeSeconds,
      path: "/",
      sameSite: "lax",
      secure: destination.protocol === "https:",
    });
    return response;
  } catch {
    return failed(request, "unavailable");
  }
}
