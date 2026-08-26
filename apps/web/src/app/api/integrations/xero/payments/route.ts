import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { pullXeroPaymentsForInvoice, type XeroPullInvoiceInput } from "@/lib/xero-payment-pull";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ invoice?: XeroPullInvoiceInput }>(request);
  const invoice = body?.invoice;
  if (!invoice?.id || !invoice.ref) {
    return NextResponse.json({ error: "Invoice id and ref are required." }, { status: 400 });
  }

  try {
    const result = await pullXeroPaymentsForInvoice(invoice);
    const actor = request.headers.get(employeeHeaderName) || "Blake";
    return NextResponse.json({ ...result, actor });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to pull Xero payments.",
      },
      { status: 400 },
    );
  }
}
