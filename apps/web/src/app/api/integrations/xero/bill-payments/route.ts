import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getStoredXeroTenantId, resolveXeroAccessToken } from "@/lib/xero-auth";

export const runtime = "nodejs";

type SupplierPaymentRecord = {
  id: string;
  paidAt: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  actor?: string;
  source?: "manual" | "xero";
  sourcePaymentId?: string;
  sourceBillId?: string;
  importedAt?: string;
  reconciled?: boolean;
};

type PullBillInput = {
  id: string;
  poNumber: string;
  billAmount: number;
  xeroBillId?: string;
  supplierPayments?: SupplierPaymentRecord[];
  supplierPaidAmount?: number;
};

type XeroPaymentRow = {
  PaymentID?: string;
  Date?: string;
  Amount?: number;
  Reference?: string;
  Status?: string;
  IsReconciled?: boolean;
  Account?: { Name?: string };
};

type XeroInvoiceRow = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Type?: string;
  Status?: string;
  Payments?: XeroPaymentRow[];
};

function toPence(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

function fromPence(value: number) {
  return Math.round(value) / 100;
}

function normalizeXeroDate(value: string | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const match = value.match(/\/Date\((\d+)/);
  if (match) return new Date(Number(match[1])).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

async function fetchXeroBillById(billId: string, accessToken: string, tenantId: string) {
  const response = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${encodeURIComponent(billId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    Invoices?: XeroInvoiceRow[];
    Message?: string;
    Detail?: string;
  };
  if (!response.ok) {
    throw new Error(body.Detail || body.Message || `Xero bill lookup by id failed (${response.status}).`);
  }
  const invoice = (body.Invoices || [])[0];
  if (!invoice?.InvoiceID) throw new Error("Xero bill id lookup returned no invoice.");
  if (invoice.Type && invoice.Type !== "ACCPAY") {
    throw new Error(`Linked Xero document is ${invoice.Type}, expected ACCPAY bill.`);
  }
  return invoice;
}

async function resolveXeroBillForPull(poNumber: string, preferredId?: string) {
  const accessToken = await resolveXeroAccessToken();
  const tenantId = getStoredXeroTenantId();
  if (!accessToken || !tenantId) {
    throw new Error(
      "Xero live token and tenant are required to pull bill payments. Connect Xero in Setup or set XERO_ACCESS_TOKEN + XERO_TENANT_ID.",
    );
  }

  if (preferredId?.trim()) {
    try {
      const byId = await fetchXeroBillById(preferredId.trim(), accessToken, tenantId);
      return { bill: byId, accessToken, tenantId, matchedBy: "id" as const };
    } catch {
      // fall through to PO number lookup
    }
  }

  const where = encodeURIComponent(`InvoiceNumber=="${poNumber.replace(/"/g, "")}"`);
  const response = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${where}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    Invoices?: XeroInvoiceRow[];
    Message?: string;
    Detail?: string;
  };
  if (!response.ok) {
    throw new Error(body.Detail || body.Message || `Xero bill lookup failed (${response.status}).`);
  }

  const bills = (body.Invoices || []).filter(
    (row) =>
      row.Type === "ACCPAY" &&
      String(row.InvoiceNumber || "").trim().toLowerCase() === poNumber.trim().toLowerCase(),
  );
  if (!bills.length) {
    throw new Error(`No Xero ACCPAY bill found with number ${poNumber}. Export the bill first, then pull payments.`);
  }
  if (bills.length > 1) {
    throw new Error(`Multiple Xero bills share number ${poNumber}. Resolve duplicates in Xero before pulling.`);
  }
  const matched = bills[0];
  if (!matched) {
    throw new Error(`No Xero ACCPAY bill found with number ${poNumber}. Export the bill first, then pull payments.`);
  }
  return { bill: matched, accessToken, tenantId, matchedBy: "number" as const };
}

async function fetchXeroPaymentsForBill(billId: string, accessToken: string, tenantId: string) {
  const where = encodeURIComponent(`Invoice.InvoiceID=Guid("${billId}")`);
  const response = await fetch(`https://api.xero.com/api.xro/2.0/Payments?where=${where}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    Payments?: XeroPaymentRow[];
    Message?: string;
    Detail?: string;
  };
  if (!response.ok) {
    throw new Error(body.Detail || body.Message || `Xero bill payments lookup failed (${response.status}).`);
  }
  return body.Payments || [];
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance && !access.canEditJobs && !access.canApprovePurchase) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ bill?: PullBillInput }>(request);
  const bill = body?.bill;
  if (!bill?.id || !bill.poNumber) {
    return NextResponse.json({ error: "PO id and poNumber are required." }, { status: 400 });
  }

  try {
    const { bill: xeroBill, accessToken, tenantId, matchedBy } = await resolveXeroBillForPull(
      bill.poNumber,
      bill.xeroBillId,
    );
    const xeroBillId = xeroBill.InvoiceID || "";
    if (!xeroBillId) {
      return NextResponse.json({ error: "Xero bill is missing InvoiceID." }, { status: 502 });
    }

    let xeroPayments = xeroBill.Payments || [];
    if (!xeroPayments.length) {
      xeroPayments = await fetchXeroPaymentsForBill(xeroBillId, accessToken, tenantId);
    }

    const existing = bill.supplierPayments || [];
    const existingIds = new Set(
      existing.flatMap((payment) =>
        [payment.id, payment.sourcePaymentId ? `xero:${payment.sourcePaymentId}` : "", payment.sourcePaymentId || ""].filter(
          Boolean,
        ),
      ),
    );

    const conflicts: Array<{ xeroPaymentId: string; reason: string }> = [];
    const added: SupplierPaymentRecord[] = [];
    const importedAt = new Date().toISOString();
    let skippedCount = 0;

    for (const row of xeroPayments) {
      const paymentId = row.PaymentID?.trim();
      if (!paymentId) {
        conflicts.push({ xeroPaymentId: "(missing)", reason: "Xero payment has no PaymentID." });
        continue;
      }
      if (String(row.Status || "").toUpperCase() === "DELETED") {
        skippedCount += 1;
        continue;
      }
      if (existingIds.has(paymentId) || existingIds.has(`xero:${paymentId}`)) {
        skippedCount += 1;
        continue;
      }

      const amount = Number(row.Amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        conflicts.push({ xeroPaymentId: paymentId, reason: "Non-positive payment amount." });
        continue;
      }

      const paidAt = normalizeXeroDate(row.Date);
      const reference = row.Reference?.trim() || undefined;
      const likelyManualDuplicate = existing.some(
        (payment) =>
          payment.source !== "xero" &&
          payment.paidAt === paidAt &&
          Math.abs(payment.amount - amount) < 0.009 &&
          (payment.reference || "") === (reference || ""),
      );
      if (likelyManualDuplicate) {
        conflicts.push({
          xeroPaymentId: paymentId,
          reason: "Likely matches an existing manual supplier payment (same date/amount/reference).",
        });
        continue;
      }

      const entry: SupplierPaymentRecord = {
        id: `xero:${paymentId}`,
        paidAt,
        amount,
        method: row.Account?.Name?.trim() || "Xero payment",
        reference,
        actor: "Xero",
        source: "xero",
        sourcePaymentId: paymentId,
        sourceBillId: xeroBillId,
        importedAt,
        reconciled: Boolean(row.IsReconciled),
        note: row.IsReconciled ? "Imported from Xero (reconciled)" : "Imported from Xero",
      };
      added.push(entry);
      existingIds.add(entry.id);
      existingIds.add(paymentId);
    }

    const nextPayments = [...existing, ...added];
    const paidPence = nextPayments.reduce((sum, payment) => sum + toPence(payment.amount), 0);
    const totalPence = toPence(bill.billAmount);
    const supplierPaidAmount = fromPence(paidPence);
    const supplierPaymentStatus =
      paidPence <= 0 ? "Unpaid" : paidPence >= totalPence - 1 ? "Paid" : "Part paid";

    const actor = request.headers.get(employeeHeaderName) || "NeXa";

    return NextResponse.json({
      ok: true,
      purchaseRequestId: bill.id,
      poNumber: bill.poNumber,
      match: {
        billNumber: xeroBill.InvoiceNumber || bill.poNumber,
        xeroBillId,
        matchedBy,
      },
      xeroBillId,
      xeroBillNumber: xeroBill.InvoiceNumber || bill.poNumber,
      fetchedCount: xeroPayments.length,
      addedCount: added.length,
      skippedCount,
      conflicts,
      addedPayments: added,
      supplierPayments: nextPayments,
      supplierPaidAmount,
      supplierPaymentStatus,
      xeroPaymentsCheckedAt: importedAt,
      actor,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to pull Xero bill payments.",
      },
      { status: 400 },
    );
  }
}
