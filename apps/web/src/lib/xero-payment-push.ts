import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { appendAuditEvent } from "@/lib/people-data";
import { xeroAccountCodesFromFinanceSettings } from "@/lib/xero-account-codes";
import { getStoredXeroTenantId, resolveXeroAccessToken } from "@/lib/xero-auth";

type LedgerPayment = {
  id: string;
  paidAt: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  actor?: string;
  source?: string;
  sourcePaymentId?: string;
  sourceInvoiceId?: string;
  importedAt?: string;
  reconciled?: boolean;
  xeroPaymentId?: string;
  xeroPushStatus?: "pushed" | "pending_export" | "failed" | "skipped";
  xeroPushError?: string;
};

type HubInvoice = {
  id: string;
  ref: string;
  customer?: string;
  status?: string;
  claimType?: string;
  accountsStatus?: string;
  xeroInvoiceId?: string;
  xeroInvoiceNumber?: string;
  payments?: LedgerPayment[];
  paidAmount?: number;
  paymentStatus?: string;
};

type XeroAccount = {
  AccountID?: string;
  Code?: string;
  Name?: string;
  Type?: string;
  Status?: string;
  EnablePaymentsToAccount?: boolean;
  BankAccountType?: string;
};

function configuredPaymentAccountCode() {
  const fromEnv = process.env.XERO_PAYMENT_ACCOUNT_CODE?.trim();
  if (fromEnv) return fromEnv;
  const finance = getHubDetailState().financeSettings;
  const fromSettings =
    finance && typeof finance === "object"
      ? String((finance as Record<string, unknown>).xeroPaymentAccountCode || "").trim()
      : "";
  return fromSettings || "";
}

async function fetchXeroAccounts(accessToken: string, tenantId: string) {
  const response = await fetch("https://api.xero.com/api.xro/2.0/Accounts", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    Accounts?: XeroAccount[];
    Message?: string;
    Detail?: string;
  };
  if (!response.ok) {
    throw new Error(body.Detail || body.Message || `Xero accounts lookup failed (${response.status}).`);
  }
  return body.Accounts || [];
}

/** Prefer configured code, else first active BANK / payments-enabled account. */
export async function resolveXeroPaymentAccount(accessToken: string, tenantId: string) {
  const accounts = await fetchXeroAccounts(accessToken, tenantId);
  const active = accounts.filter((row) => String(row.Status || "ACTIVE").toUpperCase() === "ACTIVE");
  const preferredCode = configuredPaymentAccountCode().toLowerCase();
  if (preferredCode) {
    const match = active.find((row) => String(row.Code || "").trim().toLowerCase() === preferredCode);
    if (match?.AccountID) {
      return {
        accountId: match.AccountID,
        code: match.Code || preferredCode,
        name: match.Name || match.Code || preferredCode,
        matchedBy: "configured-code" as const,
      };
    }
  }

  const bank =
    active.find((row) => String(row.Type || "").toUpperCase() === "BANK" && row.EnablePaymentsToAccount !== false) ||
    active.find((row) => String(row.Type || "").toUpperCase() === "BANK") ||
    active.find((row) => row.EnablePaymentsToAccount);

  if (!bank?.AccountID) {
    throw new Error(
      "No Xero bank/payment account found. Set XERO_PAYMENT_ACCOUNT_CODE or financeSettings.xeroPaymentAccountCode.",
    );
  }

  return {
    accountId: bank.AccountID,
    code: bank.Code || "",
    name: bank.Name || bank.Code || "Bank",
    matchedBy: "auto-bank" as const,
  };
}

async function resolveXeroInvoiceId(invoice: HubInvoice, accessToken: string, tenantId: string) {
  if (invoice.xeroInvoiceId?.trim()) return invoice.xeroInvoiceId.trim();

  const invoiceNumber = (invoice.xeroInvoiceNumber || invoice.ref || "").trim();
  if (!invoiceNumber) return null;

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
      String(row.InvoiceNumber || "").trim().toLowerCase() === invoiceNumber.toLowerCase() &&
      row.InvoiceID,
  );
  return match?.InvoiceID || null;
}

export async function createXeroPayment(input: {
  xeroInvoiceId: string;
  amount: number;
  paidAt: string;
  reference?: string;
  idempotencyKey: string;
  accessToken: string;
  tenantId: string;
}) {
  const account = await resolveXeroPaymentAccount(input.accessToken, input.tenantId);
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (amount <= 0) throw new Error("Payment amount must be positive.");

  const response = await fetch("https://api.xero.com/api.xro/2.0/Payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Xero-Tenant-Id": input.tenantId,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey.slice(0, 128),
    },
    body: JSON.stringify({
      Payments: [
        {
          Invoice: { InvoiceID: input.xeroInvoiceId },
          Account: account.code ? { Code: account.code } : { AccountID: account.accountId },
          Date: input.paidAt.slice(0, 10),
          Amount: amount,
          Reference: (input.reference || "SumUp").slice(0, 255),
        },
      ],
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    Payments?: Array<{ PaymentID?: string; Status?: string }>;
    Message?: string;
    Detail?: string;
    Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>;
  };

  if (!response.ok) {
    const validation =
      body.Elements?.[0]?.ValidationErrors?.map((row) => row.Message).filter(Boolean).join("; ") || "";
    throw new Error(validation || body.Detail || body.Message || `Xero payment create failed (${response.status}).`);
  }

  const paymentId = body.Payments?.[0]?.PaymentID;
  if (!paymentId) throw new Error("Xero payment create returned no PaymentID.");

  return {
    paymentId,
    account,
  };
}

/** After a successful Xero invoice export, push any SumUp rows still waiting. */
export async function retryPendingSumUpXeroPushes(invoiceId: string, xeroInvoiceId?: string | null) {
  const hub = getHubDetailState();
  const invoices = Array.isArray(hub.invoices) ? (hub.invoices as HubInvoice[]) : [];
  const invoice = invoices.find((row) => row.id === invoiceId);
  if (!invoice) return { ok: false as const, pushed: 0, results: [] as Awaited<ReturnType<typeof maybePushSumUpPaymentToXero>>[] };

  if (xeroInvoiceId?.trim() && invoice.xeroInvoiceId !== xeroInvoiceId.trim()) {
    saveHubDetailState({
      ...hub,
      invoices: invoices.map((row) =>
        row.id === invoiceId
          ? {
              ...invoice,
              xeroInvoiceId: xeroInvoiceId.trim(),
              xeroInvoiceNumber: invoice.xeroInvoiceNumber || invoice.ref,
              accountsStatus: "Sent" as const,
            }
          : row,
      ),
    });
  }

  const latest = (getHubDetailState().invoices as HubInvoice[] | undefined)?.find((row) => row.id === invoiceId);
  const pending = (latest?.payments || []).filter(
    (payment) => payment.source === "sumup" && !payment.xeroPaymentId && payment.xeroPushStatus !== "skipped",
  );

  const results: Awaited<ReturnType<typeof maybePushSumUpPaymentToXero>>[] = [];
  for (const payment of pending) {
    results.push(
      await maybePushSumUpPaymentToXero({
        invoiceId,
        paymentId: payment.id,
      }),
    );
  }

  const pushed = results.filter((row) => row.ok && "xeroPaymentId" in row && Boolean(row.xeroPaymentId)).length;
  return { ok: true as const, pushed, results };
}

/**
 * Best-effort: after SumUp lands on the NeXa ledger, also create the ACCREC payment in Xero
 * so cash reconcile / pull does not wait on bank feed matching.
 */
export async function maybePushSumUpPaymentToXero(input: {
  invoiceId: string;
  paymentId: string;
}) {
  const hub = getHubDetailState();
  const invoices = Array.isArray(hub.invoices) ? (hub.invoices as HubInvoice[]) : [];
  const invoice = invoices.find((row) => row.id === input.invoiceId);
  if (!invoice) return { ok: false as const, reason: "invoice_not_found" as const };

  if (invoice.status === "Draft" || invoice.status === "Cancelled" || invoice.claimType === "valuation") {
    return { ok: false as const, reason: "not_exportable" as const };
  }

  const payments = Array.isArray(invoice.payments) ? [...invoice.payments] : [];
  const index = payments.findIndex((row) => row.id === input.paymentId);
  if (index < 0) return { ok: false as const, reason: "payment_not_found" as const };
  const payment = payments[index]!;
  if (payment.xeroPaymentId) {
    return { ok: true as const, duplicate: true as const, xeroPaymentId: payment.xeroPaymentId };
  }

  const accessToken = await resolveXeroAccessToken();
  const tenantId = getStoredXeroTenantId();
  if (!accessToken || !tenantId) {
    payments[index] = {
      ...payment,
      xeroPushStatus: "pending_export",
      xeroPushError: "Xero not connected",
    };
    saveHubDetailState({
      ...hub,
      invoices: invoices.map((row) => (row.id === invoice.id ? { ...invoice, payments } : row)),
    });
    return { ok: false as const, reason: "xero_not_connected" as const };
  }

  const xeroInvoiceId = await resolveXeroInvoiceId(invoice, accessToken, tenantId);
  if (!xeroInvoiceId) {
    payments[index] = {
      ...payment,
      xeroPushStatus: "pending_export",
      xeroPushError: "Invoice not in Xero yet — export first, then retry push / pull",
    };
    saveHubDetailState({
      ...hub,
      invoices: invoices.map((row) =>
        row.id === invoice.id
          ? { ...invoice, payments, accountsStatus: invoice.accountsStatus || "Not sent" }
          : row,
      ),
    });
    return { ok: false as const, reason: "invoice_not_in_xero" as const };
  }

  try {
    const created = await createXeroPayment({
      xeroInvoiceId,
      amount: payment.amount,
      paidAt: payment.paidAt,
      reference: payment.reference || `SumUp ${invoice.ref}`,
      idempotencyKey: `sumup-${payment.sourcePaymentId || payment.id}`,
      accessToken,
      tenantId,
    });

    payments[index] = {
      ...payment,
      xeroPaymentId: created.paymentId,
      sourceInvoiceId: xeroInvoiceId,
      xeroPushStatus: "pushed",
      xeroPushError: undefined,
      note: payment.note
        ? `${payment.note} · pushed to Xero`
        : "Paid online via SumUp · pushed to Xero",
    };

    saveHubDetailState({
      ...hub,
      invoices: invoices.map((row) =>
        row.id === invoice.id
          ? {
              ...invoice,
              payments,
              xeroInvoiceId,
              xeroInvoiceNumber: invoice.xeroInvoiceNumber || invoice.ref,
              accountsStatus: invoice.accountsStatus === "Sent" ? "Sent" : invoice.accountsStatus,
            }
          : row,
      ),
    });

    appendAuditEvent({
      actor: "SumUp → Xero",
      action: "xero payment push",
      recordType: "invoice",
      recordId: invoice.id,
      summary: `${invoice.ref}: £${Number(payment.amount).toFixed(2)} SumUp payment pushed to Xero (${created.paymentId}).`,
      source: "integrations",
      importance: "high",
    });

    return {
      ok: true as const,
      duplicate: false as const,
      xeroPaymentId: created.paymentId,
      xeroInvoiceId,
      account: created.account,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Xero payment push failed";
    payments[index] = {
      ...payment,
      xeroPushStatus: "failed",
      xeroPushError: message,
    };
    saveHubDetailState({
      ...hub,
      invoices: invoices.map((row) => (row.id === invoice.id ? { ...invoice, payments } : row)),
    });
    return { ok: false as const, reason: "push_failed" as const, error: message };
  }
}
