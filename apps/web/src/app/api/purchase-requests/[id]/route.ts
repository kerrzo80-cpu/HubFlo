import { NextRequest, NextResponse } from "next/server";

import {
  updatePurchaseRequestStatus,
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

  const payload = await parseJsonRequestBody<{ status?: PurchaseStatus }>(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.status) {
    return NextResponse.json({ error: "Missing status" }, { status: 400 });
  }

  if (payload.status === "Requested") {
    return NextResponse.json(
      { error: "PO status cannot be reverted to requested" },
      { status: 400 },
    );
  }

  const updated = updatePurchaseRequestStatus(id, payload.status);
  if (!updated) {
    return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}
