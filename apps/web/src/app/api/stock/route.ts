import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  archiveStockItem,
  archiveStockLocation,
  getStockSnapshot,
  recordStockMovement,
  receivePurchaseIntoStock,
  upsertStockItem,
  upsertStockLocation,
  type StockLocationKind,
  type StockMovement,
} from "@/lib/stock-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showStock && !access.showFinance && !access.canRequestPurchase) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(getStockSnapshot());
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showStock && !access.showFinance && !access.canApprovePurchase && !access.canRequestPurchase) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{
    action?: "upsert-item" | "move" | "receive-po" | "upsert-location" | "archive-location" | "archive-item";
    item?: Parameters<typeof upsertStockItem>[0];
    location?: { id?: string; name: string; kind: StockLocationKind; engineerName?: string };
    locationId?: string;
    itemId?: string;
    movement?: {
      itemId: string;
      quantity: number;
      reason: StockMovement["reason"];
      fromLocationId?: string;
      toLocationId?: string;
      jobRef?: string;
      poNumber?: string;
      receiptKey?: string;
      note?: string;
    };
    receipt?: Parameters<typeof receivePurchaseIntoStock>[0];
  }>(request);

  const actor = request.headers.get(employeeHeaderName) || "NeXa";

  try {
    if (body?.action === "upsert-item" && body.item) {
      upsertStockItem(body.item);
      return NextResponse.json(getStockSnapshot());
    }
    if (body?.action === "archive-item" && body.itemId) {
      return NextResponse.json(archiveStockItem(body.itemId));
    }
    if (body?.action === "upsert-location" && body.location) {
      return NextResponse.json(upsertStockLocation(body.location));
    }
    if (body?.action === "archive-location" && body.locationId) {
      return NextResponse.json(archiveStockLocation(body.locationId));
    }
    if (body?.action === "move" && body.movement) {
      recordStockMovement({ ...body.movement, actor });
      return NextResponse.json(getStockSnapshot());
    }
    if (body?.action === "receive-po" && body.receipt) {
      const snapshot = receivePurchaseIntoStock({ ...body.receipt, actor });
      return NextResponse.json(snapshot);
    }
    return NextResponse.json({ error: "Unknown stock action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update stock." },
      { status: 400 },
    );
  }
}
