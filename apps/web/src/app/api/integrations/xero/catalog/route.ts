import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getStoredXeroTenantId, getXeroAuthStatus, resolveXeroAccessToken } from "@/lib/xero-auth";
import type { XeroChartAccount, XeroChartTaxRate } from "@/lib/xero-mapping";

export const runtime = "nodejs";

type XeroAccountRow = {
  Code?: string;
  Name?: string;
  Type?: string;
  TaxType?: string;
  Status?: string;
};

type XeroTaxRateRow = {
  TaxType?: string;
  Name?: string;
  CanApplyToRevenue?: boolean;
  CanApplyToExpenses?: boolean;
  Status?: string;
};

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canEditInvoice && !access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getXeroAuthStatus();
  if (!status.configured) {
    return NextResponse.json({
      connected: false,
      accounts: [] as XeroChartAccount[],
      taxRates: [] as XeroChartTaxRate[],
      status,
      error: status.canConnect
        ? "Connect Xero first — then this list fills from your Xero chart."
        : status.officeMessage,
    });
  }

  const token = await resolveXeroAccessToken();
  const tenantId = getStoredXeroTenantId();
  if (!token || !tenantId) {
    return NextResponse.json({
      connected: false,
      accounts: [],
      taxRates: [],
      status,
      error: "Xero is marked connected but the token or organisation is missing. Click Connect Xero again.",
    });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Xero-Tenant-Id": tenantId,
    Accept: "application/json",
  };

  try {
    const [accountsResponse, taxResponse] = await Promise.all([
      fetch("https://api.xero.com/api.xro/2.0/Accounts", { headers }),
      fetch("https://api.xero.com/api.xro/2.0/TaxRates", { headers }),
    ]);
    const accountsBody = (await accountsResponse.json().catch(() => ({}))) as {
      Accounts?: XeroAccountRow[];
      Message?: string;
      Detail?: string;
    };
    const taxBody = (await taxResponse.json().catch(() => ({}))) as {
      TaxRates?: XeroTaxRateRow[];
      Message?: string;
      Detail?: string;
    };
    if (!accountsResponse.ok) {
      throw new Error(accountsBody.Detail || accountsBody.Message || `Xero accounts failed (${accountsResponse.status}).`);
    }
    if (!taxResponse.ok) {
      throw new Error(taxBody.Detail || taxBody.Message || `Xero tax rates failed (${taxResponse.status}).`);
    }

    const accounts: XeroChartAccount[] = (accountsBody.Accounts || [])
      .filter((row) => row.Status !== "ARCHIVED" && row.Code)
      .map((row) => ({
        code: String(row.Code || "").trim(),
        name: String(row.Name || "").trim(),
        type: String(row.Type || "").trim(),
        taxType: String(row.TaxType || "").trim(),
        status: String(row.Status || "").trim(),
      }));
    const taxRates: XeroChartTaxRate[] = (taxBody.TaxRates || [])
      .filter((row) => row.Status !== "DELETED" && row.TaxType)
      .map((row) => ({
        taxType: String(row.TaxType || "").trim(),
        name: String(row.Name || "").trim(),
        canApplyToRevenue: Boolean(row.CanApplyToRevenue),
        canApplyToExpenses: Boolean(row.CanApplyToExpenses),
        status: String(row.Status || "").trim(),
      }));

    return NextResponse.json({
      connected: true,
      accounts,
      taxRates,
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        accounts: [] as XeroChartAccount[],
        taxRates: [] as XeroChartTaxRate[],
        status,
        error: error instanceof Error ? error.message : "Unable to load Xero chart.",
      },
      { status: 400 },
    );
  }
}
