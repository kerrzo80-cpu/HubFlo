import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { resetHubDetailState } from "@/lib/hub-detail-store";
import { resetLeadStore } from "@/lib/lead-store";
import { resetWorkflowAuditEvents } from "@/lib/people-data";
import { resetWorkflowStore } from "@/lib/workflow-data";

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateLead || !access.canCreateQuote || !access.canCreateJob || !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const workflow = resetWorkflowStore();
  const leads = resetLeadStore();
  const hubState = resetHubDetailState();
  const auditEvents = resetWorkflowAuditEvents();

  return NextResponse.json({
    workflow,
    leads: leads.leads,
    hubState,
    auditEvents,
  });
}
