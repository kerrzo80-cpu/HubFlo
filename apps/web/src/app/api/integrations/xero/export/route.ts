import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getServerStoreDirectory, loadServerStore, writeServerStore } from "@/lib/server-store";
import { getStoredXeroTenantId, getXeroAuthStatus, resolveXeroAccessToken } from "@/lib/xero-auth";

export const runtime = "nodejs";

type XeroExportInvoice = {
  id: string;
  ref: string;
  customer: string;
  issuedDate: string;
  dueDate: string;
  chargeTotal: number;
  vatRate: number;
  notes?: string;
  lines: Array<{
    description: string;
    category: string;
    chargeToClient: number;
    costToUs: number;
  }>;
};

type XeroExportRecord = {
  id: string;
  invoiceId: string;
  invoiceRef: string;
  status: "Queued" | "Sent" | "Failed";
  mode: "live-api" | "csv-pack" | "queued-local";
  createdAt: string;
  actor: string;
  detail: string;
  csvPath?: string;
  externalId?: string;
};

type XeroExportStore = {
  exports: XeroExportRecord[];
};

const STORE = "nexa-xero-exports-v1";

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildInvoiceCsv(invoice: XeroExportInvoice) {
  const rows = [
    ["ContactName", "InvoiceNumber", "InvoiceDate", "DueDate", "Description", "Quantity", "UnitAmount", "AccountCode", "TaxType", "Reference"],
    ...invoice.lines.map((line) => [
      invoice.customer,
      invoice.ref,
      invoice.issuedDate,
      invoice.dueDate,
      line.description,
      "1",
      line.chargeToClient.toFixed(2),
      line.category === "Labour" ? "200" : "200",
      invoice.vatRate > 0 ? "OUTPUT2" : "NONE",
      invoice.notes || "",
    ]),
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

async function tryLiveXeroCreate(invoice: XeroExportInvoice) {
  const accessToken = await resolveXeroAccessToken();
  const tenantId = getStoredXeroTenantId();
  if (!accessToken || !tenantId) {
    return { ok: false as const, reason: "No Xero OAuth token / static access token + tenant for live API push." };
  }

  const payload = {
    Type: "ACCREC",
    Contact: { Name: invoice.customer },
    Date: invoice.issuedDate,
    DueDate: invoice.dueDate,
    InvoiceNumber: invoice.ref,
    Reference: invoice.notes || invoice.ref,
    LineAmountTypes: "Exclusive",
    LineItems: invoice.lines.map((line) => ({
      Description: line.description,
      Quantity: 1,
      UnitAmount: line.chargeToClient,
      AccountCode: "200",
      TaxType: invoice.vatRate > 0 ? "OUTPUT2" : "NONE",
    })),
    Status: "AUTHORISED",
  };

  const response = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Invoices: [payload] }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false as const, reason: `Xero API ${response.status}: ${text.slice(0, 240)}` };
  }

  const body = await response.json().catch(() => ({})) as {
    Invoices?: Array<{ InvoiceID?: string; InvoiceNumber?: string }>;
  };
  return {
    ok: true as const,
    externalId: body.Invoices?.[0]?.InvoiceID || body.Invoices?.[0]?.InvoiceNumber || invoice.ref,
  };
}

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const store = loadServerStore<XeroExportStore>(STORE, { exports: [] });
  return NextResponse.json({
    exports: store.exports.slice(0, 100),
    liveTokenPresent: Boolean(await resolveXeroAccessToken()),
    tenantIdPresent: Boolean(getStoredXeroTenantId()),
    status: getXeroAuthStatus(),
  });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ invoice?: XeroExportInvoice }>(request);
  const invoice = body?.invoice;
  if (!invoice?.id || !invoice.ref || !invoice.lines?.length) {
    return NextResponse.json({ error: "Invoice with lines is required for Xero export." }, { status: 400 });
  }

  const actor = request.headers.get(employeeHeaderName) || "NeXa";
  const createdAt = new Date().toISOString();
  const store = loadServerStore<XeroExportStore>(STORE, { exports: [] });

  const live = await tryLiveXeroCreate(invoice).catch((error) => ({
    ok: false as const,
    reason: error instanceof Error ? error.message : "Live Xero push failed",
  }));

  let record: XeroExportRecord;
  if (live.ok) {
    record = {
      id: `xero-exp-${Date.now()}`,
      invoiceId: invoice.id,
      invoiceRef: invoice.ref,
      status: "Sent",
      mode: "live-api",
      createdAt,
      actor,
      detail: `Pushed to Xero as ${live.externalId}`,
      externalId: live.externalId,
    };
  } else {
    const csv = buildInvoiceCsv(invoice);
    const dir = path.join(getServerStoreDirectory(), "xero-exports");
    await mkdir(dir, { recursive: true });
    const fileName = `${invoice.ref.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${Date.now()}.csv`;
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, csv, "utf8");
    record = {
      id: `xero-exp-${Date.now()}`,
      invoiceId: invoice.id,
      invoiceRef: invoice.ref,
      status: "Sent",
      mode: "csv-pack",
      createdAt,
      actor,
      detail: live.reason
        ? `CSV pack ready for Xero import (${live.reason})`
        : "CSV pack ready for Xero import.",
      csvPath: ["xero-exports", fileName].join("/"),
    };
  }

  store.exports.unshift(record);
  writeServerStore(STORE, store);

  return NextResponse.json({
    export: record,
    accountsStatus: "Sent" as const,
    csv: live.ok ? null : buildInvoiceCsv(invoice),
  });
}
