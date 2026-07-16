import { NextRequest, NextResponse } from "next/server";

import {
  updatePurchaseRequest,
  updatePurchaseRequestStatus,
  type PurchaseRequest,
  type PurchaseStatus,
} from "@/lib/workflow-data";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";

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
}
