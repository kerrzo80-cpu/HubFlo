import { NextResponse } from "next/server";

import {
  createPurchaseRequest,
  getPurchaseRequests,
  type PurchaseRequest,
  type PurchaseRequestInput,
} from "@/lib/workflow-data";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canRequestPurchase && !access.canApprovePurchase) {
    return NextResponse.json([]);
  }

  return NextResponse.json(getPurchaseRequests());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canRequestPurchase) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<Partial<PurchaseRequest>>(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!payload.jobId || !payload.jobRef || !payload.supplier || !payload.item) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const created = createPurchaseRequest({
    jobId: payload.jobId,
    jobRef: payload.jobRef,
    costCentreId: payload.costCentreId,
    costCentreName: payload.costCentreName,
    requestedBy: payload.requestedBy ?? "Engineer",
    supplier: payload.supplier,
    supplierEmail: payload.supplierEmail,
    item: payload.item,
    estimatedCost: payload.estimatedCost ?? 0,
    actualCost: payload.actualCost,
    reason: payload.reason ?? "",
    status: payload.status ?? "Requested",
    poNumber: payload.poNumber,
    createdAt: payload.createdAt ?? new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    sentAt: payload.sentAt,
    invoiceFileName: payload.invoiceFileName,
    invoiceReceivedAt: payload.invoiceReceivedAt,
    receivedAt: payload.receivedAt,
    updatedAt: payload.updatedAt,
  } as PurchaseRequestInput);

  return NextResponse.json(created, { status: 201 });
}
