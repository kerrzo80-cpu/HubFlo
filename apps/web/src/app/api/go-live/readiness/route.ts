import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { hasBootstrapAdminConfiguration, listAuthUsers } from "@/lib/auth-store";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { getLeads } from "@/lib/lead-store";
import { openAiKeySource, resolveOpenAiApiKey } from "@/lib/openai-env";
import { getClientSites, getClients } from "@/lib/people-data";
import { currentStoreVerification, getLastFireDrillResult } from "@/lib/pilot-backup";
import { getOfficeBackupStatus, officeBackupIsStale } from "@/lib/office-backup";
import { getSimproBridgeStatus } from "@/lib/simpro-bridge";
import { getEstimates, getSurveys } from "@/lib/survey-estimator-store";
import { getTakeoffProjects } from "@/lib/takeoff-data";
import { getJobs, getPurchaseRequests, getQuotes } from "@/lib/workflow-data";
import { getWorkspaceMode } from "@/lib/workspace-mode";

const tenantId = "pilot-ewg";
/** Fire-drill counts as fresh for 14 days. */
const FIRE_DRILL_FRESH_MS = 14 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hubState = getHubDetailState();
  const workspaceMode = getWorkspaceMode();
  const simpro = getSimproBridgeStatus();
  const openaiConnected = Boolean(resolveOpenAiApiKey());
  const openaiSource = openAiKeySource();
  const backup = currentStoreVerification();
  const fireDrill = getLastFireDrillResult();
  const fireDrillAgeMs = fireDrill?.at ? Date.now() - Date.parse(fireDrill.at) : Number.POSITIVE_INFINITY;
  const fireDrillFresh = Boolean(fireDrill?.ok && fireDrillAgeMs <= FIRE_DRILL_FRESH_MS);
  const officeBackup = getOfficeBackupStatus();
  const officeBackupFresh = Boolean(officeBackup.lastOkAt && !officeBackupIsStale(officeBackup));

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
        ? "Company workspace — no demonstration seed records on new stores."
        : "Demo mode can still seed demonstration records on a new database.",
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
      id: "openai",
      status: openaiConnected ? "ready" : "blocked",
      label: openaiConnected ? `OpenAI key via ${openaiSource}` : "OpenAI key missing",
      detail: openaiConnected
        ? "Blake / Survey / Takeoff AI can resolve a key (env preferred, then in-app)."
        : "Set OPENAI_API_KEY / NEXA_OPENAI_API_KEY on Render, or paste a key in Setup → Blake AI.",
    },
    {
      id: "backup",
      status: backup.ok && backup.presentStoreCount > 0 ? "ready" : "warning",
      label: backup.ok
        ? `Company backup (${backup.presentStoreCount}/${backup.storeCount} stores)`
        : "Company backup unavailable",
      detail: backup.ok
        ? `${Math.round(backup.totalBytes / 1024)} KB exportable · dry-run + shadow fire-drill available`
        : "Could not summarise company stores for export.",
    },
    {
      id: "officeBackup",
      status: officeBackupFresh ? "ready" : officeBackup.lastOkAt ? "warning" : "blocked",
      label: officeBackupFresh
        ? "Office backup (records + documents)"
        : officeBackup.lastOkAt
          ? "Office backup stale (>20 hours)"
          : "Office backup not run",
      detail: officeBackup.lastOkAt
        ? `Last good copy ${officeBackup.lastOkAt}${officeBackup.lastFilename ? ` · ${officeBackup.lastFilename}` : ""}. Download from Setup → Overview and keep off this server.`
        : "Run Setup → Overview → Backup now. That saves jobs, tenders, takeoffs and PDF files.",
    },
    {
      id: "restoreFireDrill",
      status: fireDrillFresh ? "ready" : fireDrill?.ok ? "warning" : "blocked",
      label: fireDrillFresh
        ? `Restore fire-drill passed (${fireDrill!.storesMatched}/${fireDrill!.storesChecked})`
        : fireDrill?.ok
          ? "Restore fire-drill stale (>14 days)"
          : "Restore fire-drill not run",
      detail: fireDrill
        ? `Last ${fireDrill.ok ? "pass" : "fail"} at ${fireDrill.at} · ${fireDrill.ms}ms · backend ${fireDrill.backend}`
        : "Run Setup → Ops checklist → Restore fire-drill (shadow write/read, no live overwrite).",
    },
    {
      id: "simpro",
      status: "ready",
      label: simpro.configured
        ? `Simpro ${simpro.mode} bridge (optional)`
        : "Simpro not connected (optional)",
      detail:
        "Kept only until NeXa is the system of record. Not a company-production blocker.",
    },
  ];

  const companyBlockers = checks
    .filter((check) => check.id !== "simpro" && check.status === "blocked")
    .map((check) => check.id);
  const companyWarnings = checks
    .filter((check) => check.id !== "simpro" && check.status === "warning")
    .map((check) => check.id);

  return NextResponse.json({
    workspaceMode,
    authMode,
    counts,
    checks,
    companyProduction: {
      ready: companyBlockers.length === 0 && workspaceMode === "live" && individualAuthenticationReady && openaiConnected && fireDrillFresh,
      blockers: companyBlockers,
      warnings: companyWarnings,
      posture: "single-company production",
      note: "NeXa is production for your company. Multi-tenant SaaS is a later product track — not required for EWG go-live.",
    },
    openai: {
      connected: openaiConnected,
      source: openaiSource,
    },
    backup: backup.ok
      ? {
          presentStoreCount: backup.presentStoreCount,
          storeCount: backup.storeCount,
          totalBytes: backup.totalBytes,
        }
      : null,
    fireDrill,
    simpro: {
      configured: simpro.configured,
      mode: simpro.mode,
      endpoint: simpro.endpoint,
      missing: simpro.missing,
      optional: true,
    },
    checkedAt: new Date().toISOString(),
  });
}
