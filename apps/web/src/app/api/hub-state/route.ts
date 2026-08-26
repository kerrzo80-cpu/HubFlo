import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { ensureGasCertTrialInCore } from "@/lib/gas-cert-trial-core";
import { ensureDomesticStopGoSeed } from "@/lib/domestic-stop-go/seed";
import { reconcileDayworkVariationsFromEvidence } from "@/lib/engineer-flow";
import { getHubDetailState, saveHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { mergeHubDetailState } from "@/lib/hub-state-merge";
import { leanJobCostCentresMap } from "@/lib/job-cost-centres-lean";
import { parseJsonRequestBody } from "@/lib/http";
import { stripDayworkBlobsForPoll } from "@/lib/daywork-poll-strip";
import { sanitizeHubStateForClient } from "@/lib/hub-state-sanitize";
import { getLeads } from "@/lib/lead-store";
import {
  assertNoHubScheduleClashes,
  leadSurveysToAssignments,
  type HubScheduleAssignment,
} from "@/lib/schedule-clash";
import { useDemoSeedData } from "@/lib/workspace-mode";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.showQuotes && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (useDemoSeedData()) {
    ensureGasCertTrialInCore();
    ensureDomesticStopGoSeed();
  }
  try {
    reconcileDayworkVariationsFromEvidence();
  } catch {
    // Best-effort backfill of Daywork variation cards from Field evidence.
  }
  // Poll responses omit base64 signatures and lean job cost centres — never echo BoQ dumps.
  const state = sanitizeHubStateForClient(stripDayworkBlobsForPoll(getHubDetailState()));
  if (state.jobCostCentres && typeof state.jobCostCentres === "object") {
    leanJobCostCentresMap(state.jobCostCentres);
  }
  return NextResponse.json(state);
}

export async function PUT(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.canCreateQuote && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const payload = await parseJsonRequestBody<HubDetailState>(request);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Collapse tender BoQ dumps in the inbound payload before merge/clone.
    if (payload.jobCostCentres && typeof payload.jobCostCentres === "object") {
      leanJobCostCentresMap(payload.jobCostCentres);
    }

    const current = getHubDetailState();
    const merged = mergeHubDetailState(current, payload);

    if (payload.jobSchedulePlans !== undefined) {
      // Only hard-block when schedule plans actually change. Pre-existing imported
      // clashes must not fail every unrelated hub autosave (Setup, invoices, etc.).
      const before = JSON.stringify(current.jobSchedulePlans ?? {});
      const after = JSON.stringify(payload.jobSchedulePlans ?? {});
      if (before !== after) {
        const leadAssignments = leadSurveysToAssignments(getLeads());
        const clashError = assertNoHubScheduleClashes(
          (merged.jobSchedulePlans || {}) as Record<string, HubScheduleAssignment[]>,
          leadAssignments,
        );
        if (clashError) {
          return NextResponse.json({ error: clashError, code: "SCHEDULE_CLASH" }, { status: 409 });
        }
      }
    }

    const saved = saveHubDetailState(merged);
    try {
      reconcileDayworkVariationsFromEvidence();
    } catch {
      // Best-effort: rebuild Daywork variation cards if Core omitted them.
    }
    // Autosave callers only check ok — never echo the full hub (that OOMed Render on volume jobs).
    return NextResponse.json({
      ok: true,
      updatedAt: saved.updatedAt || new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hub save failed";
    const oom = /heap|out of memory|ENOMEM|allocation/i.test(message);
    return NextResponse.json(
      { error: oom ? "Hub save too large — try again after closing fat BoQ views." : message },
      { status: oom ? 413 : 500 },
    );
  }
}
