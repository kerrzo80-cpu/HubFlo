import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { hasBootstrapAdminConfiguration, listAuthUsers } from "@/lib/auth-store";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { getLeads } from "@/lib/lead-store";
import { getClientSites, getClients } from "@/lib/people-data";
import { getSimproBridgeStatus } from "@/lib/simpro-bridge";
import { getEstimates, getSurveys } from "@/lib/survey-estimator-store";
import { getTakeoffProjects } from "@/lib/takeoff-data";
import { getJobs, getPurchaseRequests, getQuotes } from "@/lib/workflow-data";
import { getWorkspaceMode } from "@/lib/workspace-mode";

const tenantId = "pilot-ewg";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hubState = getHubDetailState();
  const workspaceMode = getWorkspaceMode();
  const simpro = getSimproBridgeStatus();
  const counts = {
    clients: getClients().length,
    sites: getClientSites().length,
    leads: getLeads().length,
    quotes: getQuotes().length,
    jobs: getJobs().length,
    purchaseOrders: getPurchaseRequests().length,
    invoices: Array.isArray(hubState.invoices) ? hubState.invoices.length : 0,
    surveys: getSurveys(tenantId).length,
    estimates: getEstimates(tenantId).length,
    takeoffs: getTakeoffProjects().length,
    employees: Array.isArray(hubState.employees) ? hubState.employees.length : 0,
  };

  const authMode = process.env.NEXA_AUTH_MODE?.trim().toLowerCase() || "pilot";
  const authUsers = listAuthUsers();
  const individualAuthenticationReady = authMode === "users" && (authUsers.length > 0 || hasBootstrapAdminConfiguration());
  const checks = [
    {
      id: "workspace",
      status: workspaceMode === "live" ? "ready" : "warning",
      label: workspaceMode === "live" ? "Live workspace mode" : "Demo workspace mode",
      detail: workspaceMode === "live"
        ? "New stores start without demonstration business records."
        : "This service can still seed demonstration records on a new database.",
    },
    {
      id: "authentication",
      status: individualAuthenticationReady ? "ready" : "blocked",
      label: individualAuthenticationReady ? "Individual user authentication" : "Shared or incomplete authentication",
      detail: individualAuthenticationReady
        ? `${authUsers.length} server-verified user account(s) are configured.`
        : "Individual server-verified accounts must replace the shared pilot login before launch.",
    },
    {
      id: "simpro",
      status: simpro.configured ? "warning" : "blocked",
      label: simpro.configured ? `Simpro ${simpro.mode} connection detected` : "Simpro connection incomplete",
      detail: simpro.configured
        ? "Connection is available, but entity-by-entity reconciliation is still required before two-way writes."
        : `Missing: ${simpro.missing.join(", ")}`,
    },
  ];

  return NextResponse.json({
    workspaceMode,
    authMode,
    counts,
    checks,
    simpro: {
      configured: simpro.configured,
      mode: simpro.mode,
      endpoint: simpro.endpoint,
      missing: simpro.missing,
    },
    checkedAt: new Date().toISOString(),
  });
}
