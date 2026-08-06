import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { getLastReconciled, markReconciled } from "@/lib/cash-reconcile-periods";

export const runtime = "nodejs";

function canManage(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

export async function GET(request: NextRequest) {
  if (!canManage(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ lastReconciled: getLastReconciled() });
}

export async function POST(request: NextRequest) {
  if (!canManage(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { periodKey?: string } | null;
  const periodKey = body?.periodKey?.trim() || new Date().toISOString().slice(0, 7);
  const actor = request.headers.get(employeeHeaderName) || "NeXa Reports";

  try {
    const lastReconciled = markReconciled(periodKey, actor);
    return NextResponse.json({ ok: true, lastReconciled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not mark period reconciled.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
