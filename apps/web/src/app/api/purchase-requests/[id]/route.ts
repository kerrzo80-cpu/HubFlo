import { NextRequest, NextResponse } from "next/server";

import {
  removePurchaseRequest,
  updatePurchaseRequest,
  updatePurchaseRequestStatus,
  type PurchaseRequest,
  type PurchaseStatus,
} from "@/lib/workflow-data";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { parseJsonRequestBody } from "@/lib/http";
import { recordLockErrorResponse } from "@/lib/record-lock-http";
import { assertRecordLockForWrite } from "@/lib/record-edit-locks";
import { appendAuditEvent } from "@/lib/people-data";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canApprovePurchase) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const removed = removePurchaseRequest(id);
  if (!removed) {
    return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
  }

  appendAuditEvent({
    actor: "HubFlo user",
    action: "deleted",
    recordType: "purchase order",
    recordId: id,
    summary: `Purchase request ${id} deleted.`,
    source: "purchase orders",
    importance: "high",
  });
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canApprovePurchase) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<Partial<PurchaseRequest>>(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const authUser = getAuthenticatedUser(request);
  try {
    if (authUser) {
      assertRecordLockForWrite({ recordType: "po", recordId: id, userId: authUser.id });
    }
    const updated = Object.keys(payload).length === 1 && payload.status
      ? updatePurchaseRequestStatus(id, payload.status as Exclude<PurchaseStatus, "Requested">)
      : updatePurchaseRequest(id, payload);
    if (!updated) {
      return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
    }

    const action =
      updated.status === "Received"
        ? "received"
        : updated.status === "Part received"
          ? "part received"
          : updated.status === "Approved"
            ? "approved"
            : "updated";
    appendAuditEvent({
      actor: "HubFlo user",
      action,
      recordType: "purchase order",
      recordId: updated.id,
      summary:
        updated.status === "Received"
          ? `${updated.poNumber} supplier invoice received against ${updated.jobRef} / ${updated.costCentreName || "unassigned cost centre"} at £${(updated.actualCost ?? 0).toFixed(2)}.`
          : `${updated.poNumber || "Purchase request"} ${action} for ${updated.jobRef} / ${updated.costCentreName || "unassigned cost centre"}.`,
      source: "purchase orders",
      importance: ["Received", "Approved", "Disputed"].includes(updated.status) ? "high" : "normal",
    });
    return NextResponse.json(updated);
  } catch (error) {
    const locked = recordLockErrorResponse(error);
    if (locked) return locked;
    throw error;
  }
}
