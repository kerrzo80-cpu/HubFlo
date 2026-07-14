import { NextRequest, NextResponse } from "next/server";

import {
  updatePurchaseRequest,
  updatePurchaseRequestStatus,
  type PurchaseRequest,
  type PurchaseStatus,
} from "@/lib/workflow-data";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";

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
  return NextResponse.json(updated);
}
