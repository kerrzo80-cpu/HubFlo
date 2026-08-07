import { NextResponse } from "next/server";

import {
  ACCOUNTING_PROVIDER_OPTIONS,
  defaultXeroRedirectUri,
  getAccountingProvider,
  getStoredAccountingProviderConfig,
  resolveXeroAppCredentials,
  saveAccountingProviderConfig,
  type AccountingProvider,
} from "@/lib/accounting-provider-store";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { clearXeroConnection, getXeroAuthStatus } from "@/lib/xero-auth";

export const runtime = "nodejs";

function forbid(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  return !access.showFinance && !access.canEditInvoice && !access.canCustomize;
}

export async function GET(request: Request) {
  if (forbid(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const stored = getStoredAccountingProviderConfig();
  const app = resolveXeroAppCredentials();
  const xero = getXeroAuthStatus();

  return NextResponse.json({
    provider: getAccountingProvider(),
    options: ACCOUNTING_PROVIDER_OPTIONS,
    xeroApp: {
      source: app.source,
      ready: app.ready,
      hasSetupCredentials: app.hasSetupCredentials,
      clientIdSet: Boolean(app.clientId),
      clientSecretSet: Boolean(app.clientSecret),
      redirectUri: app.redirectUri,
      defaultRedirectUri: defaultXeroRedirectUri(),
      /** Masked preview for Setup form (never return secret). */
      clientIdPreview: stored.xeroClientId
        ? `${stored.xeroClientId.slice(0, 6)}…`
        : app.source === "env"
          ? "(from platform env)"
          : "",
    },
    xero,
    checkedAt: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  if (forbid(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    provider?: AccountingProvider;
    xeroClientId?: string;
    xeroClientSecret?: string;
    xeroRedirectUri?: string;
    disconnectXero?: boolean;
    clearSetupCredentials?: boolean;
  };

  if (body.disconnectXero) {
    clearXeroConnection();
  }

  if (body.clearSetupCredentials) {
    saveAccountingProviderConfig({
      xeroClientId: "",
      xeroClientSecret: "",
      xeroRedirectUri: "",
    });
  }

  if (body.provider === "quickbooks" || body.provider === "sage") {
    return NextResponse.json(
      {
        error: `${body.provider === "quickbooks" ? "QuickBooks" : "Sage"} uses the same Setup connect pattern — not live yet. Choose Xero or None / CSV for now.`,
      },
      { status: 400 },
    );
  }

  const saved = saveAccountingProviderConfig({
    provider: body.provider,
    xeroClientId: body.xeroClientId,
    xeroClientSecret: body.xeroClientSecret,
    xeroRedirectUri: body.xeroRedirectUri,
  });

  return NextResponse.json({
    ok: true,
    provider: saved.provider || "none",
    xero: getXeroAuthStatus(),
    app: resolveXeroAppCredentials(),
  });
}
