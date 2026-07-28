import { NextRequest, NextResponse } from "next/server";

import { exchangeXeroAuthorizationCode, getXeroAuthStatus } from "@/lib/xero-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const error = url.searchParams.get("error") || "";
  const origin = url.origin;

  if (error) {
    return NextResponse.redirect(`${origin}/?xero=error&message=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/?xero=error&message=${encodeURIComponent("Missing authorisation code")}`);
  }

  try {
    await exchangeXeroAuthorizationCode(code);
    return NextResponse.redirect(`${origin}/?xero=connected`);
  } catch (exchangeError) {
    const message = exchangeError instanceof Error ? exchangeError.message : "Xero connect failed";
    return NextResponse.redirect(`${origin}/?xero=error&message=${encodeURIComponent(message)}`);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  try {
    const result = await exchangeXeroAuthorizationCode(body?.code || "");
    return NextResponse.json({
      ok: true,
      ...result,
      status: getXeroAuthStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to exchange Xero code.",
        status: getXeroAuthStatus(),
      },
      { status: 400 },
    );
  }
}
