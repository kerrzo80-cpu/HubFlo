import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getStoredXeroTenantId, resolveXeroAccessToken } from "@/lib/xero-auth";

export const runtime = "nodejs";

type LedgerPayment = {
  id: string;
  paidAt: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  actor?: string;
  source?: "manual" | "xero" | "sumup" | "stripe" | "adjustment";
  sourcePaymentId?: string;
  sourceInvoiceId?: string;
  importedAt?: string;
  reconciled?: boolean;
  xeroPaymentId?: string;
};

type PullInvoiceInput = {
  id: string;
  ref: string;
  chargeTotal: number;
  vatRate: number;
  status?: string;
  claimType?: string;
  payments?: LedgerPayment[];
  paidAmount?: number;
  xeroInvoiceId?: string;
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
  // Xero often returns /Date(1719792000000+0000)/
  const match = value.match(/\/Date\((\d+)/);
  if (match) {
    return new Date(Number(match[1])).toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

async function fetchXeroInvoiceById(invoiceId: string, accessToken: string, tenantId: string) {
  const response = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${encodeURIComponent(invoiceId)}`, {
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
    throw new Error(body.Detail || body.Message || `Xero invoice lookup by id failed (${response.status}).`);
  }
  const invoice = (body.Invoices || [])[0];
  if (!invoice?.InvoiceID) throw new Error("Xero invoice id lookup returned no invoice.");
  if (invoice.Type && invoice.Type !== "ACCREC") {
    throw new Error(`Linked Xero invoice is ${invoice.Type}, expected ACCREC.`);
  }
  return invoice;
}

async function resolveXeroInvoiceForPull(invoiceNumber: string, preferredId?: string) {
  const accessToken = await resolveXeroAccessToken();
  const tenantId = getStoredXeroTenantId();
  if (!accessToken || !tenantId) {
    throw new Error("Xero live token and tenant are required to pull payments. Connect Xero in Setup or set XERO_ACCESS_TOKEN + XERO_TENANT_ID.");
  }

  if (preferredId?.trim()) {
    try {
      const byId = await fetchXeroInvoiceById(preferredId.trim(), accessToken, tenantId);
      return { invoice: byId, accessToken, tenantId, matchedBy: "id" as const };
    } catch {
      // fall through to number lookup for stale links
    }
  }

  const where = encodeURIComponent(`InvoiceNumber=="${invoiceNumber.replace(/"/g, "")}"`);
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
    throw new Error(
      body.Detail || body.Message || `Xero invoice lookup failed (${response.status}).`,
    );
  }

  const invoices = (body.Invoices || []).filter(
    (row) =>
      row.Type === "ACCREC" &&
      String(row.InvoiceNumber || "").trim().toLowerCase() === invoiceNumber.trim().toLowerCase(),
  );
  if (!invoices.length) {
    throw new Error(`No Xero ACCREC invoice found with number ${invoiceNumber}. Export it first, then pull payments.`);
  }
  if (invoices.length > 1) {
    throw new Error(`Multiple Xero invoices share number ${invoiceNumber}. Resolve duplicates in Xero before pulling.`);
  }
  const matched = invoices[0];
  if (!matched) {
    throw new Error(`No Xero ACCREC invoice found with number ${invoiceNumber}. Export it first, then pull payments.`);
  }
  return { invoice: matched, accessToken, tenantId, matchedBy: "number" as const };
}

async function fetchXeroPaymentsForInvoice(invoiceId: string, accessToken: string, tenantId: string) {
  const where = encodeURIComponent(`Invoice.InvoiceID=Guid("${invoiceId}")`);
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
    throw new Error(body.Detail || body.Message || `Xero payments lookup failed (${response.status}).`);
  }
  return body.Payments || [];
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ invoice?: PullInvoiceInput }>(request);
  const invoice = body?.invoice;
  if (!invoice?.id || !invoice.ref) {
    return NextResponse.json({ error: "Invoice id and ref are required." }, { status: 400 });
  }
  if (invoice.claimType === "valuation") {
    return NextResponse.json(
      { error: "Convert the valuation to a progress claim before pulling Xero payments." },
      { status: 400 },
    );
  }
  if (invoice.status === "Draft" || invoice.status === "Cancelled") {
    return NextResponse.json({ error: "Draft or cancelled invoices cannot pull Xero payments." }, { status: 400 });
  }

  try {
    const { invoice: xeroInvoice, accessToken, tenantId, matchedBy } = await resolveXeroInvoiceForPull(
      invoice.ref,
      invoice.xeroInvoiceId,
    );
    const xeroInvoiceId = xeroInvoice.InvoiceID || "";
    if (!xeroInvoiceId) {
      return NextResponse.json({ error: "Xero invoice is missing InvoiceID." }, { status: 502 });
    }

    let xeroPayments = xeroInvoice.Payments || [];
    if (!xeroPayments.length) {
      xeroPayments = await fetchXeroPaymentsForInvoice(xeroInvoiceId, accessToken, tenantId);
    }

    const existing = invoice.payments || [];
    const existingIds = new Set(
      existing.flatMap((payment) =>
        [payment.id, payment.sourcePaymentId ? `xero:${payment.sourcePaymentId}` : "", payment.sourcePaymentId || ""].filter(Boolean),
      ),
    );

    const conflicts: Array<{ xeroPaymentId: string; reason: string }> = [];
    const added: LedgerPayment[] = [];
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
      const alreadyLinkedSumUp = existing.some(
        (payment) =>
          payment.source === "sumup" &&
          (payment as { xeroPaymentId?: string }).xeroPaymentId === paymentId,
      );
      if (alreadyLinkedSumUp) {
        skippedCount += 1;
        continue;
      }
      const likelyManualDuplicate = existing.some(
        (payment) =>
          payment.source !== "xero" &&
          payment.paidAt === paidAt &&
          Math.abs(payment.amount - amount) < 0.009 &&
          ((payment.reference || "") === (reference || "") ||
            payment.source === "sumup" ||
            /sumup/i.test(payment.method || "") ||
            /sumup/i.test(reference || "")),
      );
      if (likelyManualDuplicate) {
        conflicts.push({
          xeroPaymentId: paymentId,
          reason:
            "Likely matches an existing SumUp/manual payment (same date/amount). Review before importing to avoid double-count.",
        });
        continue;
      }

      const entry: LedgerPayment = {
        id: `xero:${paymentId}`,
        paidAt,
        amount,
        method: row.Account?.Name?.trim() || "Xero payment",
        reference,
        actor: "Xero",
        source: "xero",
        sourcePaymentId: paymentId,
        sourceInvoiceId: xeroInvoiceId,
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
    const totalPence = toPence(invoice.chargeTotal * (1 + (invoice.vatRate || 0) / 100));
    const paidAmount = fromPence(paidPence);
    const paymentStatus =
      paidPence <= 0 ? "Unpaid" : paidPence >= totalPence - 1 ? "Paid" : "Part paid";
    const nextStatus =
      paymentStatus === "Paid"
        ? "Paid"
        : paymentStatus === "Part paid"
          ? "Partially paid"
          : invoice.status === "Paid" || invoice.status === "Partially paid"
            ? "Sent"
            : invoice.status || "Sent";

    const actor = request.headers.get(employeeHeaderName) || "NeXa";

    return NextResponse.json({
      ok: true,
      invoiceId: invoice.id,
      invoiceRef: invoice.ref,
      match: {
        invoiceNumber: xeroInvoice.InvoiceNumber || invoice.ref,
        xeroInvoiceId,
        matchedBy,
      },
      xeroInvoiceId,
      xeroInvoiceNumber: xeroInvoice.InvoiceNumber || invoice.ref,
      fetchedCount: xeroPayments.length,
      addedCount: added.length,
      skippedCount,
      conflicts,
      addedPayments: added,
      payments: nextPayments,
      paidAmount,
      paymentStatus,
      status: nextStatus,
      checkedAt: importedAt,
      actor,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to pull Xero payments.",
      },
      { status: 400 },
    );
  }
}
