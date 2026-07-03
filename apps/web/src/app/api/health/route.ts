import { NextResponse } from "next/server";

import { getServerStoreBackend } from "@/lib/server-store";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "nexa",
    store: getServerStoreBackend(),
    checkedAt: new Date().toISOString(),
  });
}
