import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  dueRecurringPlans,
  deleteRecurringPlan,
  listRecurringPlans,
  markRecurringGenerated,
  setRecurringActive,
  syncRecurringPlansFromSiteAssets,
  upcomingRecurringPlans,
  upsertRecurringPlan,
  windowRecurringJobPlans,
  type RecurringFrequency,
  type RecurringKind,
} from "@/lib/recurring-data";
import { generateDueRecurringPlans, generateRecurringPlanById } from "@/lib/recurring-generate";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const includeInactive = request.nextUrl.searchParams.get("all") === "1";
  const asOf = request.nextUrl.searchParams.get("asOf") || undefined;
  const upcomingDays = Number(request.nextUrl.searchParams.get("upcomingDays") || "28");
  // Keep yearly service plans aligned with site asset next-service dates.
  try {
    syncRecurringPlansFromSiteAssets();
  } catch {
    // best-effort
  }
  const days = Number.isFinite(upcomingDays) ? upcomingDays : 28;
  return NextResponse.json({
    plans: listRecurringPlans(includeInactive),
    due: dueRecurringPlans(asOf),
    upcoming: upcomingRecurringPlans(days, asOf),
    windowJobs: windowRecurringJobPlans(days, asOf),
  });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateJob && !access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{
    action?: "upsert" | "activate" | "deactivate" | "mark-generated" | "delete" | "generate" | "generate-due";
    id?: string;
    kind?: RecurringKind;
    name?: string;
    customer?: string;
    clientId?: string;
    siteId?: string;
    site?: string;
    description?: string;
    frequency?: RecurringFrequency;
    nextDueDate?: string;
    amount?: number;
    notes?: string;
    generatedRef?: string;
    active?: boolean;
    asOf?: string;
    actor?: string;
    limit?: number;
  }>(request);

  try {
    if (body?.action === "generate") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const result = generateRecurringPlanById({ id: body.id, actor: body.actor });
      const plan = listRecurringPlans(true).find((item) => item.id === body.id) ?? null;
      return NextResponse.json({
        result,
        generated: [result],
        plan,
        plans: listRecurringPlans(true),
        due: dueRecurringPlans(),
        upcoming: upcomingRecurringPlans(),
      });
    }
    if (body?.action === "generate-due") {
      const result = generateDueRecurringPlans({ asOf: body.asOf, actor: body.actor, limit: body.limit });
      return NextResponse.json({
        ...result,
        plans: listRecurringPlans(true),
        due: dueRecurringPlans(body.asOf),
        upcoming: upcomingRecurringPlans(7, body.asOf),
      });
    }
    if (body?.action === "delete") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      return NextResponse.json({
        plans: deleteRecurringPlan(body.id),
        due: dueRecurringPlans(),
        upcoming: upcomingRecurringPlans(),
      });
    }
    if (body?.action === "activate" || body?.action === "deactivate") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      return NextResponse.json({
        plans: setRecurringActive(body.id, body.action === "activate"),
        due: dueRecurringPlans(),
        upcoming: upcomingRecurringPlans(),
      });
    }
    if (body?.action === "mark-generated") {
      if (!body.id || !body.generatedRef) {
        return NextResponse.json({ error: "id and generatedRef required" }, { status: 400 });
      }
      const plan = markRecurringGenerated(body.id, body.generatedRef);
      return NextResponse.json({ plan, plans: listRecurringPlans(true), due: dueRecurringPlans(), upcoming: upcomingRecurringPlans() });
    }
    if (!body?.kind || !body.name || !body.customer || !body.description || !body.frequency || !body.nextDueDate) {
      return NextResponse.json({ error: "Missing required recurring plan fields." }, { status: 400 });
    }
    const plans = upsertRecurringPlan({
      id: body.id,
      kind: body.kind,
      name: body.name,
      customer: body.customer,
      clientId: body.clientId,
      siteId: body.siteId,
      site: body.site,
      description: body.description,
      frequency: body.frequency,
      nextDueDate: body.nextDueDate,
      amount: body.amount,
      notes: body.notes,
      active: body.active,
    });
    return NextResponse.json({ plans, due: dueRecurringPlans(), upcoming: upcomingRecurringPlans() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save recurring plan." },
      { status: 400 },
    );
  }
}
