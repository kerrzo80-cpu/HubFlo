import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { appendAuditEvent } from "@/lib/people-data";
import {
  applyPendingSupplierCreditNote,
  decidePendingInvoiceAdjustment,
  submitSupplierCreditNote,
  submitSupplierInvoice,
} from "@/lib/purchase-invoice-flow";
import { saveUploadedRecordDocument } from "@/lib/record-documents";
import { getPurchaseRequests, updatePurchaseRequest } from "@/lib/workflow-data";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function actorName(request: Request) {
  return request.headers.get("x-nexa-auth-user-name") || "NeXa user";
}

function parseProposedLines(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const description = String(row.description || "").trim();
      if (!description) return null;
      return {
        description,
        quantity: Number(row.quantity) || 0,
        actualCost: Number(row.actualCost) || 0,
        estimatedCost: row.estimatedCost !== undefined ? Number(row.estimatedCost) || 0 : undefined,
        catalogItemId: typeof row.catalogItemId === "string" ? row.catalogItemId : undefined,
        sku: typeof row.sku === "string" ? row.sku : undefined,
        purchaseOrderLineId: typeof row.purchaseOrderLineId === "string" ? row.purchaseOrderLineId : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function parseCreditLines(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      return {
        purchaseOrderLineId: typeof row.purchaseOrderLineId === "string" ? row.purchaseOrderLineId : undefined,
        description: String(row.description || "Credit line").trim() || "Credit line",
        creditAmount: Number(row.creditAmount) || 0,
        quantityRemoved: row.quantityRemoved !== undefined ? Number(row.quantityRemoved) || 0 : undefined,
        removeLine: Boolean(row.removeLine),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export async function POST(request: NextRequest, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canApprovePurchase && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const po = getPurchaseRequests().find((item) => item.id === id);
  if (!po) return NextResponse.json({ error: "PO not found." }, { status: 404 });

  const contentType = request.headers.get("content-type") || "";
  const actor = actorName(request);

  // Multipart: upload invoice or credit note file + metadata
  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
    }

    const kind = String(formData.get("kind") || "invoice").trim();
    const amount = Number(formData.get("amount") || 0);
    const reference = String(formData.get("reference") || "").trim();
    const notes = String(formData.get("notes") || "").trim();
    const applyNow = String(formData.get("applyNow") || "true") !== "false";
    const proposedLines = parseProposedLines(
      (() => {
        try {
          return JSON.parse(String(formData.get("proposedLines") || "[]"));
        } catch {
          return [];
        }
      })(),
    );
    const creditLines = parseCreditLines(
      (() => {
        try {
          return JSON.parse(String(formData.get("creditLines") || "[]"));
        } catch {
          return [];
        }
      })(),
    );

    const file = formData.get("file");
    let documentId: string | undefined;
    let fileUrl: string | undefined;
    let fileName = String(formData.get("fileName") || "").trim();
    let mimeType: string | undefined;

    if (typeof File !== "undefined" && file instanceof File) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const saved = saveUploadedRecordDocument({
        scope: "purchase",
        recordRef: po.poNumber || po.id,
        folderId: kind === "credit" ? "supplier-credits" : "supplier-invoices",
        visibility: "Private",
        fileName: file.name || "upload.bin",
        mimeType: file.type || "application/octet-stream",
        bytes,
      });
      documentId = saved.id;
      fileUrl = saved.fileUrl;
      fileName = saved.name;
      mimeType = saved.type;
    }

    try {
      if (kind === "credit") {
        const result = submitSupplierCreditNote(po, {
          creditAmount: amount,
          reference: reference || undefined,
          fileName: fileName || `${po.poNumber || po.id} credit note`,
          documentId,
          fileUrl,
          uploadedBy: actor,
          applyNow,
          lines: creditLines,
        });
        const updated = updatePurchaseRequest(po.id, result.patch);
        appendAuditEvent({
          actor,
          action: applyNow ? "applied supplier credit note" : "uploaded supplier credit note",
          recordType: "purchase_request",
          recordId: po.id,
          summary: `${po.poNumber || "PO"} credit ${result.credit.reference || result.credit.fileName} · £${result.credit.creditAmount.toFixed(2)}`,
          source: "web",
          importance: "high",
        });
        return NextResponse.json({
          ok: true,
          kind: "credit",
          credit: result.credit,
          purchaseRequest: updated,
          applied: applyNow,
        });
      }

      const result = submitSupplierInvoice(po, {
        amount,
        reference: reference || undefined,
        fileName: fileName || `${po.poNumber || po.id} supplier invoice`,
        documentId,
        fileUrl,
        mimeType,
        uploadedBy: actor,
        proposedLines,
        notes: notes || undefined,
      });
      const updated = updatePurchaseRequest(po.id, result.patch);
      appendAuditEvent({
        actor,
        action: result.requiresApproval ? "queued second supplier invoice for approval" : "uploaded supplier invoice",
        recordType: "purchase_request",
        recordId: po.id,
        summary: `${po.poNumber || "PO"} invoice ${result.document.reference || result.document.fileName} · £${result.document.amount.toFixed(2)}${
          result.requiresApproval ? " · awaiting approval" : ""
        }`,
        source: "web",
        importance: "high",
      });
      return NextResponse.json({
        ok: true,
        kind: "invoice",
        requiresApproval: result.requiresApproval,
        document: result.document,
        adjustment: result.adjustment,
        purchaseRequest: updated,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not save supplier document." },
        { status: 400 },
      );
    }
  }

  // JSON actions: approve/reject adjustment, apply credit
  let body: {
    action?: string;
    adjustmentId?: string;
    creditId?: string;
    decisionNote?: string;
    amount?: number;
    reference?: string;
    fileName?: string;
    proposedLines?: unknown;
    creditLines?: unknown;
    applyNow?: boolean;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    if (body.action === "approve_adjustment" || body.action === "reject_adjustment") {
      if (!access.canApprovePurchase) {
        return NextResponse.json({ error: "Your role cannot approve PO invoice adjustments." }, { status: 403 });
      }
      if (!body.adjustmentId) {
        return NextResponse.json({ error: "adjustmentId is required." }, { status: 400 });
      }
      const result = decidePendingInvoiceAdjustment(
        po,
        body.adjustmentId,
        body.action === "approve_adjustment" ? "Approved" : "Rejected",
        actor,
        body.decisionNote,
      );
      const updated = updatePurchaseRequest(po.id, result.patch);
      appendAuditEvent({
        actor,
        action: body.action === "approve_adjustment" ? "approved second supplier invoice" : "rejected second supplier invoice",
        recordType: "purchase_request",
        recordId: po.id,
        summary: `${po.poNumber || "PO"} second invoice ${result.adjustment.status.toLowerCase()}`,
        source: "web",
        importance: "high",
      });
      return NextResponse.json({ ok: true, adjustment: result.adjustment, purchaseRequest: updated });
    }

    if (body.action === "apply_credit") {
      if (!body.creditId) {
        return NextResponse.json({ error: "creditId is required." }, { status: 400 });
      }
      const result = applyPendingSupplierCreditNote(po, body.creditId, actor);
      const updated = updatePurchaseRequest(po.id, result.patch);
      appendAuditEvent({
        actor,
        action: "applied supplier credit note",
        recordType: "purchase_request",
        recordId: po.id,
        summary: `${po.poNumber || "PO"} credit applied · £${result.credit.creditAmount.toFixed(2)}`,
        source: "web",
        importance: "high",
      });
      return NextResponse.json({ ok: true, credit: result.credit, purchaseRequest: updated });
    }

    if (body.action === "save_invoice") {
      const result = submitSupplierInvoice(po, {
        amount: Number(body.amount) || 0,
        reference: body.reference,
        fileName: body.fileName || `${po.poNumber || po.id} supplier invoice`,
        uploadedBy: actor,
        proposedLines: parseProposedLines(body.proposedLines),
      });
      const updated = updatePurchaseRequest(po.id, result.patch);
      return NextResponse.json({
        ok: true,
        requiresApproval: result.requiresApproval,
        document: result.document,
        adjustment: result.adjustment,
        purchaseRequest: updated,
      });
    }

    if (body.action === "save_credit") {
      const result = submitSupplierCreditNote(po, {
        creditAmount: Number(body.amount) || 0,
        reference: body.reference,
        fileName: body.fileName || `${po.poNumber || po.id} credit note`,
        uploadedBy: actor,
        applyNow: body.applyNow !== false,
        lines: parseCreditLines(body.creditLines),
      });
      const updated = updatePurchaseRequest(po.id, result.patch);
      return NextResponse.json({
        ok: true,
        credit: result.credit,
        purchaseRequest: updated,
        applied: body.applyNow !== false,
      });
    }

    return NextResponse.json(
      { error: "Unsupported action. Use multipart upload or approve_adjustment / reject_adjustment / apply_credit / save_invoice / save_credit." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update supplier documents." },
      { status: 400 },
    );
  }
}
