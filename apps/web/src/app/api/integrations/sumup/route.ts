import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  clearStoredSumUpConfig,
  getSumUpMerchantCode,
  isSumUpConfigured,
  saveStoredSumUpConfig,
  sumUpKeySource,
} from "@/lib/sumup-key-store";

export const runtime = "nodejs";

function statusPayload() {
  const merchant = getSumUpMerchantCode();
  return {
    connected: isSumUpConfigured(),
    source: sumUpKeySource(),
    merchantCode: merchant ? `${merchant.slice(0, 2)}…${merchant.slice(-2)}` : "",
    hasMerchantCode: Boolean(merchant),
  };
}

export async function GET() {
  return NextResponse.json(statusPayload());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    apiKey?: string;
    merchantCode?: string;
  } | null;

  if (!body?.apiKey?.trim() && !isSumUpConfigured()) {
    return NextResponse.json({ error: "Paste your SumUp API key from the Developers dashboard." }, { status: 400 });
  }
  if (!body?.merchantCode?.trim() && !getSumUpMerchantCode()) {
    return NextResponse.json({ error: "Merchant code is required (e.g. MCxxxxxx from SumUp)." }, { status: 400 });
  }

  saveStoredSumUpConfig({
    apiKey: body?.apiKey,
    merchantCode: body?.merchantCode,
  });

  return NextResponse.json({ ...statusPayload(), ok: true });
}

export async function DELETE(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  clearStoredSumUpConfig();
  return NextResponse.json({ ...statusPayload(), ok: true });
}
