import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { ensureGasCertTrialInCore } from "@/lib/gas-cert-trial-core";
import { ensureDomesticStopGoSeed } from "@/lib/domestic-stop-go/seed";
import { peekHubDetailState, saveHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { mergeHubDetailState } from "@/lib/hub-state-merge";
import { leanJobCostCentresMap } from "@/lib/job-cost-centres-lean";
import { parseJsonRequestBody } from "@/lib/http";
import { stripDayworkBlobsForPoll } from "@/lib/daywork-poll-strip";
import { leanHubStateForOfficePoll } from "@/lib/hub-poll-lean";
import { sanitizeHubStateForClient } from "@/lib/hub-state-sanitize";
import { getLeads } from "@/lib/lead-store";
import { isPassaroundBusy } from "@/lib/passaround-busy";
import { assertRecordLockForWrite, type RecordLockType } from "@/lib/record-edit-locks";
import { recordLockErrorResponse } from "@/lib/record-lock-http";
import {
  assertNoHubScheduleClashes,
  leadSurveysToAssignments,
  type HubScheduleAssignment,
} from "@/lib/schedule-clash";
import { useDemoSeedData } from "@/lib/workspace-mode";

/** Stable compare for schedule plans — ignores object key insertion order. */
function hubSchedulePlansSignature(plans: unknown): string {
  if (!plans || typeof plans !== "object") return "";
  const rows: string[] = [];
  for (const [jobId, list] of Object.entries(plans as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      rows.push(
        [
          jobId,
          String(row.id || ""),
          String(row.employeeId || ""),
          String(row.employeeName || ""),
          String(row.startDate || ""),
          String(row.startTime || ""),
          String(row.endDate || ""),
          String(row.endTime || ""),
        ].join("|"),
      );
    }
  }
  rows.sort();
  return rows.join("\n");
}

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.showQuotes && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (useDemoSeedData()) {
    ensureGasCertTrialInCore();
    ensureDomesticStopGoSeed();
  }
  // Do NOT run daywork reconcile on hub poll — it deep-clones the full hub and can OOM
  // Render during office polls overlapping passaround ticks.
  // Daywork reconcile stays on Field daywork write/PDF routes only.
  try {
    // Poll responses omit base64 signatures and BoQ/takeoff maps — never echo fat dumps.
    // Use peek (no disk rehydrate + deep clone) so office polling does not OOM between passaround ticks.
    const state = leanHubStateForOfficePoll(
      sanitizeHubStateForClient(stripDayworkBlobsForPoll(peekHubDetailState())),
    );
    return NextResponse.json(state);
  } catch (error) {
    // Fat hub clone/OOM must not blank the office — return the slices passaround needs.
    try {
      const hub = peekHubDetailState();
      return NextResponse.json({
        jobReviews: hub.jobReviews || {},
        employees: hub.employees || [],
        financeSettings: hub.financeSettings || {},
        businessSettings: hub.businessSettings || {},
        workflowRules: hub.workflowRules || {},
        jobSchedulePlans: hub.jobSchedulePlans || {},
        invoices: [],
        jobCostCentres: {},
        jobSections: {},
        hubDegraded: true,
        hubDegradedReason: error instanceof Error ? error.message : "hub serialize failed",
      });
    } catch {
      return NextResponse.json(
        { error: "Hub state unavailable", jobReviews: {}, hubDegraded: true },
        { status: 503 },
      );
    }
  }
}

export async function PUT(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.canCreateQuote && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Passaround owns the process briefly — a concurrent full hub save OOMs live (UI Mark complete).
  if (isPassaroundBusy()) {
    return NextResponse.json({ ok: true, deferred: true, reason: "passaround_busy" });
  }

  try {
    const raw = await parseJsonRequestBody<
      HubDetailState & { recordLockContext?: { recordType: RecordLockType; recordId: string } }
    >(request);
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const recordLockContext = raw.recordLockContext;
    const payload: HubDetailState = { ...raw };
    delete (payload as { recordLockContext?: unknown }).recordLockContext;

    const authUser = getAuthenticatedUser(request);
    if (authUser && recordLockContext?.recordId) {
      assertRecordLockForWrite({
        recordType: recordLockContext.recordType,
        recordId: recordLockContext.recordId,
        userId: authUser.id,
      });
    }

    // Collapse tender BoQ dumps in the inbound payload before merge/clone.
    if (payload.jobCostCentres && typeof payload.jobCostCentres === "object") {
      leanJobCostCentresMap(payload.jobCostCentres);
    }

    // Passaround owns jobReviews via /api/jobs/[id]/passaround + lean side store.
    // Ignoring inbound reviews stops tick-driven hub autosaves from rewriting the fat hub.
    delete (payload as { jobReviews?: unknown }).jobReviews;

    // Peek (in-memory) — never full rehydrate+deep-clone on autosave. That path OOMs live when
    // a poll/PUT overlaps passaround. saveHubDetailState still rehydrates daywork fields from disk.
    const current = peekHubDetailState();
    const merged = mergeHubDetailState(current, payload);

    if (payload.jobSchedulePlans !== undefined) {
      // Only hard-block when schedule plans actually change. Pre-existing imported
      // clashes must not fail every unrelated hub autosave (Setup, invoices, etc.).
      // Use a sorted assignment signature — JSON.stringify key order alone is unstable
      // across client rebuilds and was re-blocking review/invoice saves on live data.
      const before = hubSchedulePlansSignature(current.jobSchedulePlans);
      const after = hubSchedulePlansSignature(payload.jobSchedulePlans);
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
    // Autosave callers only check ok — never echo the full hub (that OOMed Render on volume jobs).
    return NextResponse.json({
      ok: true,
      updatedAt: saved.updatedAt || new Date().toISOString(),
    });
  } catch (error) {
    const locked = recordLockErrorResponse(error);
    if (locked) return locked;
    const message = error instanceof Error ? error.message : "Hub save failed";
    const oom = /heap|out of memory|ENOMEM|allocation/i.test(message);
    return NextResponse.json(
      { error: oom ? "Hub save too large — try again after closing fat BoQ views." : message },
      { status: oom ? 413 : 500 },
    );
  }
}
