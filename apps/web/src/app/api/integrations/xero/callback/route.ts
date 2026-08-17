import { NextRequest, NextResponse } from "next/server";

import { nexaPublicOrigin } from "@/lib/accounting-provider-store";
import {
  exchangeXeroAuthorizationCode,
  getXeroAuthStatus,
  officeMessageForXeroOAuthError,
} from "@/lib/xero-auth";

export const runtime = "nodejs";

function appOrigin(request: NextRequest) {
  return nexaPublicOrigin(request);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const error = url.searchParams.get("error") || "";
  const state = url.searchParams.get("state") || "";
  const origin = appOrigin(request);

  if (error) {
    const description = url.searchParams.get("error_description") || error;
    const message = officeMessageForXeroOAuthError(error, description);
    return NextResponse.redirect(`${origin}/?xero=error&message=${encodeURIComponent(message)}`);
  }
  if (!code) {
    return NextResponse.redirect(
      `${origin}/?xero=error&message=${encodeURIComponent("Missing authorisation code")}`,
    );
  }

  try {
    await exchangeXeroAuthorizationCode(code, { state, request });
    return NextResponse.redirect(`${origin}/?xero=connected`);
  } catch (exchangeError) {
    const message = exchangeError instanceof Error ? exchangeError.message : "Xero connect failed";
    return NextResponse.redirect(`${origin}/?xero=error&message=${encodeURIComponent(message)}`);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: string; state?: string } | null;
  try {
    const result = await exchangeXeroAuthorizationCode(body?.code || "", { state: body?.state, request });
    return NextResponse.json({
      ok: true,
      ...result,
      status: getXeroAuthStatus(request),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to exchange Xero code.",
        status: getXeroAuthStatus(request),
      },
      { status: 400 },
    );
  }
}
