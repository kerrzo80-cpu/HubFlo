import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getServerStoreDirectory, loadServerStore, writeServerStore } from "@/lib/server-store";
import { getStoredXeroTenantId, resolveXeroAccessToken } from "@/lib/xero-auth";

export const runtime = "nodejs";

type XeroBillLine = {
  description: string;
  quantity: number;
  unitAmount: number;
};

type XeroBillInput = {
  id: string;
  poNumber: string;
  supplier: string;
  jobRef?: string;
  issuedDate?: string;
  dueDate?: string;
  notes?: string;
  xeroBillId?: string;
  lines: XeroBillLine[];
};

type XeroBillExportRecord = {
  id: string;
  purchaseRequestId: string;
  poNumber: string;
  status: "Queued" | "Sent" | "Failed";
  mode: "live-api" | "csv-pack";
  createdAt: string;
  actor: string;
  detail: string;
  csvPath?: string;
  xeroBillId?: string;
  xeroBillNumber?: string;
  updatedExisting?: boolean;
};

type XeroBillExportStore = {
  exports: XeroBillExportRecord[];
};

const STORE = "nexa-xero-bills-v1";

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildBillCsv(bill: XeroBillInput) {
  const rows = [
    ["ContactName", "InvoiceNumber", "InvoiceDate", "DueDate", "Description", "Quantity", "UnitAmount", "AccountCode", "TaxType", "Reference"],
    ...bill.lines.map((line) => [
      bill.supplier,
      bill.poNumber,
      bill.issuedDate || new Date().toISOString().slice(0, 10),
      bill.dueDate || bill.issuedDate || new Date().toISOString().slice(0, 10),
      line.description,
      String(line.quantity || 1),
      line.unitAmount.toFixed(2),
      "310",
      "INPUT2",
      bill.notes || bill.jobRef || "",
    ]),
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

async function findXeroBillIdByNumber(billNumber: string, accessToken: string, tenantId: string) {
  const where = encodeURIComponent(`InvoiceNumber=="${billNumber.replace(/"/g, "")}"`);
  const response = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${where}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as {
    Invoices?: Array<{ InvoiceID?: string; InvoiceNumber?: string; Type?: string }>;
  };
  const match = (body.Invoices || []).find(
    (row) =>
      row.Type === "ACCPAY" &&
      String(row.InvoiceNumber || "").trim().toLowerCase() === billNumber.trim().toLowerCase() &&
      row.InvoiceID,
  );
  if (!match?.InvoiceID) return null;
  return { billId: match.InvoiceID, billNumber: match.InvoiceNumber || billNumber };
}

async function tryLiveXeroBillUpsert(bill: XeroBillInput) {
  const accessToken = await resolveXeroAccessToken();
  const tenantId = getStoredXeroTenantId();
  if (!accessToken || !tenantId) {
    return { ok: false as const, reason: "No Xero OAuth token / static access token + tenant for live bill push." };
  }

  let xeroBillId = bill.xeroBillId?.trim() || "";
  let updatedExisting = Boolean(xeroBillId);
  if (!xeroBillId) {
    const existing = await findXeroBillIdByNumber(bill.poNumber, accessToken, tenantId).catch(() => null);
    if (existing?.billId) {
      xeroBillId = existing.billId;
      updatedExisting = true;
    }
  }

  const issuedDate = bill.issuedDate || new Date().toISOString().slice(0, 10);
  const payload: Record<string, unknown> = {
    Type: "ACCPAY",
    Contact: { Name: bill.supplier },
    Date: issuedDate,
    DueDate: bill.dueDate || issuedDate,
    InvoiceNumber: bill.poNumber,
    Reference: bill.notes || bill.jobRef || bill.poNumber,
    LineAmountTypes: "Exclusive",
    LineItems: bill.lines.map((line) => ({
      Description: line.description,
      Quantity: Math.max(line.quantity || 1, 0.0001),
      UnitAmount: line.unitAmount,
      AccountCode: "310",
      TaxType: "INPUT2",
    })),
    Status: "AUTHORISED",
  };
  if (xeroBillId) payload.InvoiceID = xeroBillId;

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

  const body = (await response.json().catch(() => ({}))) as {
    Invoices?: Array<{ InvoiceID?: string; InvoiceNumber?: string }>;
  };
  const returned = body.Invoices?.[0];
  return {
    ok: true as const,
    xeroBillId: returned?.InvoiceID || xeroBillId || "",
    xeroBillNumber: returned?.InvoiceNumber || bill.poNumber,
    updatedExisting,
  };
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance && !access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ bill?: XeroBillInput }>(request);
  const bill = body?.bill;
  if (!bill?.id || !bill.poNumber || !bill.supplier || !bill.lines?.length) {
    return NextResponse.json(
      { error: "PO bill needs id, poNumber, supplier and at least one line." },
      { status: 400 },
    );
  }

  const actor = request.headers.get(employeeHeaderName) || "Blake";
  const createdAt = new Date().toISOString();
  const store = loadServerStore<XeroBillExportStore>(STORE, { exports: [] });

  const live = await tryLiveXeroBillUpsert(bill).catch((error) => ({
    ok: false as const,
    reason: error instanceof Error ? error.message : "Live Xero bill push failed",
  }));

  let record: XeroBillExportRecord;
  if (live.ok) {
    record = {
      id: `xero-bill-${Date.now()}`,
      purchaseRequestId: bill.id,
      poNumber: bill.poNumber,
      status: "Sent",
      mode: "live-api",
      createdAt,
      actor,
      detail: live.updatedExisting
        ? `Updated Xero bill ${live.xeroBillNumber} (${live.xeroBillId})`
        : `Created Xero bill ${live.xeroBillNumber} (${live.xeroBillId})`,
      xeroBillId: live.xeroBillId || undefined,
      xeroBillNumber: live.xeroBillNumber,
      updatedExisting: live.updatedExisting,
    };
  } else {
    const csv = buildBillCsv(bill);
    const dir = path.join(getServerStoreDirectory(), "xero-bills");
    await mkdir(dir, { recursive: true });
    const fileName = `${bill.poNumber.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${Date.now()}.csv`;
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, csv, "utf8");
    record = {
      id: `xero-bill-${Date.now()}`,
      purchaseRequestId: bill.id,
      poNumber: bill.poNumber,
      status: "Sent",
      mode: "csv-pack",
      createdAt,
      actor,
      detail: live.reason
        ? `CSV pack ready for Xero bill import (${live.reason})`
        : "CSV pack ready for Xero bill import.",
      csvPath: ["xero-bills", fileName].join("/"),
    };
  }

  store.exports.unshift(record);
  writeServerStore(STORE, store);

  return NextResponse.json({
    export: record,
    accountsStatus: "Sent" as const,
    csv: live.ok ? null : buildBillCsv(bill),
    xeroBillId: live.ok ? live.xeroBillId || null : null,
    xeroBillNumber: live.ok ? live.xeroBillNumber || bill.poNumber : null,
    xeroExportedAt: live.ok ? createdAt : null,
  });
}
