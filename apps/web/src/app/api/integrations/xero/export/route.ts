import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getServerStoreDirectory, loadServerStore, writeServerStore } from "@/lib/server-store";
import { getStoredXeroTenantId, getXeroAuthStatus, resolveXeroAccessToken } from "@/lib/xero-auth";
import { retryPendingSumUpXeroPushes } from "@/lib/xero-payment-push";

export const runtime = "nodejs";

type XeroExportInvoice = {
  id: string;
  ref: string;
  customer: string;
  customerEmail?: string;
  xeroContactId?: string;
  clientId?: string;
  issuedDate: string;
  dueDate: string;
  chargeTotal: number;
  vatRate: number;
  notes?: string;
  claimType?: string;
  creditOfRef?: string;
  creditOfXeroInvoiceId?: string;
  xeroInvoiceId?: string;
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
  xeroInvoiceId?: string;
  xeroInvoiceNumber?: string;
  updatedExisting?: boolean;
  documentKind?: "invoice" | "credit-note";
};

type XeroExportStore = {
  exports: XeroExportRecord[];
};

const STORE = "nexa-xero-exports-v1";

function isCreditNote(invoice: XeroExportInvoice) {
  return invoice.claimType === "credit-note";
}

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildInvoiceCsv(invoice: XeroExportInvoice) {
  if (isCreditNote(invoice)) {
    const rows = [
      [
        "ContactName",
        "CreditNoteNumber",
        "CreditNoteDate",
        "Description",
        "Quantity",
        "UnitAmount",
        "AccountCode",
        "TaxType",
        "Reference",
        "InvoiceNumber",
      ],
      ...invoice.lines.map((line) => [
        invoice.customer,
        invoice.ref,
        invoice.issuedDate,
        line.description,
        "1",
        line.chargeToClient.toFixed(2),
        "200",
        invoice.vatRate > 0 ? "OUTPUT2" : "NONE",
        invoice.notes || "",
        invoice.creditOfRef || "",
      ]),
    ];
    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

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

async function findXeroInvoiceIdByNumber(
  invoiceNumber: string,
  accessToken: string,
  tenantId: string,
): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  const where = encodeURIComponent(`InvoiceNumber=="${invoiceNumber.replace(/"/g, "")}"`);
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
      row.Type === "ACCREC" &&
      String(row.InvoiceNumber || "").trim().toLowerCase() === invoiceNumber.trim().toLowerCase() &&
      row.InvoiceID,
  );
  if (!match?.InvoiceID) return null;
  return { invoiceId: match.InvoiceID, invoiceNumber: match.InvoiceNumber || invoiceNumber };
}

async function findXeroCreditNoteIdByNumber(
  creditNoteNumber: string,
  accessToken: string,
  tenantId: string,
): Promise<{ creditNoteId: string; creditNoteNumber: string } | null> {
  const where = encodeURIComponent(`CreditNoteNumber=="${creditNoteNumber.replace(/"/g, "")}"`);
  const response = await fetch(`https://api.xero.com/api.xro/2.0/CreditNotes?where=${where}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as {
    CreditNotes?: Array<{ CreditNoteID?: string; CreditNoteNumber?: string; Type?: string }>;
  };
  const match = (body.CreditNotes || []).find(
    (row) =>
      row.Type === "ACCRECCREDIT" &&
      String(row.CreditNoteNumber || "").trim().toLowerCase() === creditNoteNumber.trim().toLowerCase() &&
      row.CreditNoteID,
  );
  if (!match?.CreditNoteID) return null;
  return { creditNoteId: match.CreditNoteID, creditNoteNumber: match.CreditNoteNumber || creditNoteNumber };
}

async function resolveXeroContact(
  invoice: XeroExportInvoice,
  accessToken: string,
  tenantId: string,
): Promise<{ contactId?: string; contactName: string; created: boolean; matched: boolean }> {
  const contactName = invoice.customer.trim();
  if (!contactName) return { contactName: "Customer", created: false, matched: false };

  if (invoice.xeroContactId?.trim()) {
    return {
      contactId: invoice.xeroContactId.trim(),
      contactName,
      created: false,
      matched: true,
    };
  }

  const where = encodeURIComponent(`Name=="${contactName.replace(/"/g, "")}"`);
  const lookup = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?where=${where}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (lookup.ok) {
    const body = (await lookup.json().catch(() => ({}))) as {
      Contacts?: Array<{ ContactID?: string; Name?: string }>;
    };
    const match = (body.Contacts || []).find(
      (row) =>
        row.ContactID &&
        String(row.Name || "").trim().toLowerCase() === contactName.toLowerCase(),
    );
    if (match?.ContactID) {
      return { contactId: match.ContactID, contactName, created: false, matched: true };
    }
  }

  const createPayload: Record<string, unknown> = {
    Name: contactName,
    IsCustomer: true,
  };
  if (invoice.customerEmail?.trim()) {
    createPayload.EmailAddress = invoice.customerEmail.trim();
  }

  const create = await fetch("https://api.xero.com/api.xro/2.0/Contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Contacts: [createPayload] }),
  });
  if (!create.ok) {
    return { contactName, created: false, matched: false };
  }
  const createdBody = (await create.json().catch(() => ({}))) as {
    Contacts?: Array<{ ContactID?: string; Name?: string }>;
  };
  const created = createdBody.Contacts?.[0];
  if (created?.ContactID) {
    return {
      contactId: created.ContactID,
      contactName: created.Name || contactName,
      created: true,
      matched: false,
    };
  }
  return { contactName, created: false, matched: false };
}

async function tryLiveXeroCreditUpsert(invoice: XeroExportInvoice) {
  const accessToken = await resolveXeroAccessToken();
  const tenantId = getStoredXeroTenantId();
  if (!accessToken || !tenantId) {
    return { ok: false as const, reason: "No Xero OAuth token / static access token + tenant for live API push." };
  }

  let xeroCreditNoteId = invoice.xeroInvoiceId?.trim() || "";
  let updatedExisting = Boolean(xeroCreditNoteId);
  if (!xeroCreditNoteId) {
    const existing = await findXeroCreditNoteIdByNumber(invoice.ref, accessToken, tenantId).catch(() => null);
    if (existing?.creditNoteId) {
      xeroCreditNoteId = existing.creditNoteId;
      updatedExisting = true;
    }
  }

  const contact = await resolveXeroContact(invoice, accessToken, tenantId).catch(() => ({
    contactId: undefined as string | undefined,
    contactName: invoice.customer,
    created: false,
    matched: false,
  }));

  const contactPayload: Record<string, unknown> = contact.contactId
    ? { ContactID: contact.contactId }
    : { Name: contact.contactName || invoice.customer };

  let allocatedInvoiceId = invoice.creditOfXeroInvoiceId?.trim() || "";
  if (!allocatedInvoiceId && invoice.creditOfRef?.trim()) {
    const linked = await findXeroInvoiceIdByNumber(invoice.creditOfRef.trim(), accessToken, tenantId).catch(() => null);
    allocatedInvoiceId = linked?.invoiceId || "";
  }

  const creditTotal = invoice.lines.reduce((sum, line) => sum + Math.max(0, line.chargeToClient), 0);
  const payload: Record<string, unknown> = {
    Type: "ACCRECCREDIT",
    Contact: contactPayload,
    Date: invoice.issuedDate,
    CreditNoteNumber: invoice.ref,
    Reference: invoice.creditOfRef
      ? `Credit against ${invoice.creditOfRef}${invoice.notes ? ` · ${invoice.notes}` : ""}`
      : invoice.notes || invoice.ref,
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
  if (xeroCreditNoteId) payload.CreditNoteID = xeroCreditNoteId;
  if (allocatedInvoiceId && creditTotal > 0) {
    payload.Allocations = [
      {
        Invoice: { InvoiceID: allocatedInvoiceId },
        Amount: Number((creditTotal * (1 + Math.max(0, invoice.vatRate) / 100)).toFixed(2)),
      },
    ];
  }

  const response = await fetch("https://api.xero.com/api.xro/2.0/CreditNotes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ CreditNotes: [payload] }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false as const, reason: `Xero API ${response.status}: ${text.slice(0, 240)}` };
  }

  const body = (await response.json().catch(() => ({}))) as {
    CreditNotes?: Array<{ CreditNoteID?: string; CreditNoteNumber?: string; Contact?: { ContactID?: string } }>;
  };
  const returned = body.CreditNotes?.[0];
  const externalId = returned?.CreditNoteID || xeroCreditNoteId || returned?.CreditNoteNumber || invoice.ref;
  return {
    ok: true as const,
    externalId,
    xeroInvoiceId: returned?.CreditNoteID || xeroCreditNoteId || "",
    xeroInvoiceNumber: returned?.CreditNoteNumber || invoice.ref,
    xeroContactId: returned?.Contact?.ContactID || contact.contactId || "",
    contactCreated: contact.created,
    contactMatched: contact.matched,
    updatedExisting,
    documentKind: "credit-note" as const,
    allocated: Boolean(allocatedInvoiceId),
  };
}

async function tryLiveXeroUpsert(invoice: XeroExportInvoice) {
  if (isCreditNote(invoice)) {
    return tryLiveXeroCreditUpsert(invoice);
  }

  const accessToken = await resolveXeroAccessToken();
  const tenantId = getStoredXeroTenantId();
  if (!accessToken || !tenantId) {
    return { ok: false as const, reason: "No Xero OAuth token / static access token + tenant for live API push." };
  }

  let xeroInvoiceId = invoice.xeroInvoiceId?.trim() || "";
  let updatedExisting = Boolean(xeroInvoiceId);
  if (!xeroInvoiceId) {
    const existing = await findXeroInvoiceIdByNumber(invoice.ref, accessToken, tenantId).catch(() => null);
    if (existing?.invoiceId) {
      xeroInvoiceId = existing.invoiceId;
      updatedExisting = true;
    }
  }

  const contact = await resolveXeroContact(invoice, accessToken, tenantId).catch(() => ({
    contactId: undefined as string | undefined,
    contactName: invoice.customer,
    created: false,
    matched: false,
  }));

  const contactPayload: Record<string, unknown> = contact.contactId
    ? { ContactID: contact.contactId }
    : { Name: contact.contactName || invoice.customer };

  const payload: Record<string, unknown> = {
    Type: "ACCREC",
    Contact: contactPayload,
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
  if (xeroInvoiceId) payload.InvoiceID = xeroInvoiceId;

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
    Invoices?: Array<{ InvoiceID?: string; InvoiceNumber?: string; Contact?: { ContactID?: string } }>;
  };
  const returned = body.Invoices?.[0];
  const externalId = returned?.InvoiceID || xeroInvoiceId || returned?.InvoiceNumber || invoice.ref;
  return {
    ok: true as const,
    externalId,
    xeroInvoiceId: returned?.InvoiceID || xeroInvoiceId || "",
    xeroInvoiceNumber: returned?.InvoiceNumber || invoice.ref,
    xeroContactId: returned?.Contact?.ContactID || contact.contactId || "",
    contactCreated: contact.created,
    contactMatched: contact.matched,
    updatedExisting,
    documentKind: "invoice" as const,
    allocated: false,
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
  // Creating/updating live Xero invoices is a mutation — require invoice-edit
  // permission. Finance *visibility* (showFinance, e.g. Read-only) is not enough.
  if (!access.canEditInvoice) {
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
  const credit = isCreditNote(invoice);

  const live = await tryLiveXeroUpsert(invoice).catch((error) => ({
    ok: false as const,
    reason: error instanceof Error ? error.message : "Live Xero push failed",
  }));

  let record: XeroExportRecord;
  if (live.ok) {
    const contactNote = live.contactCreated
      ? " · created Xero contact"
      : live.contactMatched || live.xeroContactId
        ? " · linked Xero contact"
        : "";
    const allocationNote = credit && "allocated" in live && live.allocated ? " · allocated to original invoice" : "";
    const label = credit ? "credit note" : "invoice";
    record = {
      id: `xero-exp-${Date.now()}`,
      invoiceId: invoice.id,
      invoiceRef: invoice.ref,
      status: "Sent",
      mode: "live-api",
      createdAt,
      actor,
      detail: live.updatedExisting
        ? `Updated existing Xero ${label} ${live.xeroInvoiceNumber || invoice.ref} (${live.xeroInvoiceId || live.externalId})${contactNote}${allocationNote}`
        : `Created Xero ${label} ${live.xeroInvoiceNumber || invoice.ref} (${live.xeroInvoiceId || live.externalId})${contactNote}${allocationNote}`,
      externalId: live.externalId,
      xeroInvoiceId: live.xeroInvoiceId || undefined,
      xeroInvoiceNumber: live.xeroInvoiceNumber || invoice.ref,
      updatedExisting: live.updatedExisting,
      documentKind: credit ? "credit-note" : "invoice",
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
      // The invoice is NOT in Xero yet — only a CSV awaiting manual import (or
      // the live push failed). Keep it queued so a transient failure can't make
      // an invoice look posted to Xero.
      status: "Queued",
      mode: "csv-pack",
      createdAt,
      actor,
      detail: live.reason
        ? `CSV pack ready for Xero ${credit ? "credit note " : ""}import (${live.reason})`
        : `CSV pack ready for Xero ${credit ? "credit note " : ""}import.`,
      csvPath: ["xero-exports", fileName].join("/"),
      documentKind: credit ? "credit-note" : "invoice",
    };
  }

  store.exports.unshift(record);
  writeServerStore(STORE, store);

  let sumupPaymentPush: { pushed: number } | null = null;
  if (live.ok && live.xeroInvoiceId && !credit) {
    try {
      const retry = await retryPendingSumUpXeroPushes(invoice.id, live.xeroInvoiceId);
      sumupPaymentPush = { pushed: retry.pushed };
    } catch {
      sumupPaymentPush = { pushed: 0 };
    }
  }

  return NextResponse.json({
    export: record,
    accountsStatus: live.ok ? ("Sent" as const) : ("Queued" as const),
    csv: live.ok ? null : buildInvoiceCsv(invoice),
    xeroInvoiceId: live.ok ? live.xeroInvoiceId || null : null,
    xeroInvoiceNumber: live.ok ? live.xeroInvoiceNumber || invoice.ref : null,
    xeroExportedAt: live.ok ? createdAt : null,
    xeroContactId: live.ok ? live.xeroContactId || null : null,
    clientId: invoice.clientId || null,
    sumupPaymentPush,
  });
}
