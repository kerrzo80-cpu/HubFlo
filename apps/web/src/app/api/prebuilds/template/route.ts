import { NextResponse } from "next/server";

import { KITS_CSV_TEMPLATE } from "@/lib/kit-csv-import";

export const runtime = "nodejs";

export async function GET() {
  return new NextResponse(KITS_CSV_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="blake-kits-template.csv"',
    },
  });
}
