import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";

const xeroRequiredKeys = ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_TENANT_ID"] as const;

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const missing = xeroRequiredKeys.filter((key) => !process.env[key]?.trim());
  const detectedEnvKeys = Object.keys(process.env)
    .filter((key) => key.startsWith("XERO_"))
    .sort();

  return NextResponse.json({
    configured: missing.length === 0,
    missing,
    detectedEnvKeys,
    tenantIdPresent: Boolean(process.env.XERO_TENANT_ID?.trim()),
    redirectUriPresent: Boolean(process.env.XERO_REDIRECT_URI?.trim()),
    checkedAt: new Date().toISOString(),
  });
}
