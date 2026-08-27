import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { parseJsonRequestBody } from "@/lib/http";
import {
  completeJobPassaround,
  forceJobReviewsComplete,
  readJobInvoiceReview,
  readyJobForInvoice,
  setJobReviewTick,
  type JobReviewKey,
} from "@/lib/job-passaround";
import { appendAuditEvent } from "@/lib/people-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_KEYS = new Set<JobReviewKey>(["construction", "commercial", "office"]);

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.showCore) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const jobId = String(id || "").trim();
  if (!jobId) return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  return NextResponse.json({ ok: true, review: readJobInvoiceReview(jobId) });
}

export async function POST(request: NextRequest, context: Ctx) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const jobId = String(id || "").trim();
  if (!jobId) return NextResponse.json({ error: "Missing job id" }, { status: 400 });

  const body = (await parseJsonRequestBody<Record<string, unknown>>(request)) || {};
  const action = String(body.action || "").trim();
  const authUser = getAuthenticatedUser(request);
  const actor =
    (typeof body.by === "string" && body.by.trim()) ||
    authUser?.name ||
    "NeXa user";

  try {
    if (action === "set-review") {
      const key = String(body.key || "").trim() as JobReviewKey;
      if (!REVIEW_KEYS.has(key)) {
        return NextResponse.json({ error: "Invalid review key", message: "Invalid review key" }, { status: 400 });
      }
      const approved = Boolean(body.approved);
      const review = setJobReviewTick(jobId, key, approved);
      appendAuditEvent({
        actor,
        action: "reviewed",
        recordType: "job",
        recordId: jobId,
        summary: `${key} ${approved ? "approved" : "unchecked"} via passaround API.`,
        source: "job passaround api",
        importance: "normal",
      });
      return NextResponse.json({ ok: true, review });
    }

    if (action === "force-reviews") {
      const review = forceJobReviewsComplete(jobId);
      return NextResponse.json({ ok: true, review });
    }

    if (action === "complete") {
      const job = completeJobPassaround(jobId, actor);
      return NextResponse.json({ ok: true, job, review: readJobInvoiceReview(jobId) });
    }

    if (action === "ready-to-invoice") {
      const result = readyJobForInvoice(jobId, actor);
      return NextResponse.json({ ok: true, job: result.job, review: result.review });
    }

    return NextResponse.json(
      {
        error: "Unknown action. Use set-review | force-reviews | complete | ready-to-invoice",
        message: "Unknown action. Use set-review | force-reviews | complete | ready-to-invoice",
      },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passaround failed";
    const status = /not found/i.test(message)
      ? 404
      : /complete all reviews|already|cannot|approvals/i.test(message)
        ? 409
        : 400;
    return NextResponse.json({ error: message, message }, { status });
  }
}
