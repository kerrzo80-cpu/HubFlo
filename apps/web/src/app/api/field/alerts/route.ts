import { NextResponse } from "next/server";

import { getEngineerSchedule } from "@/lib/engineer-data";
import { resolveFieldEngineerId } from "@/lib/field/field-scope";
import { withLiveFieldDates } from "@/lib/field/nexa/from-core";
import { getPurchaseRequests } from "@/lib/workflow-data";

export const runtime = "nodejs";

export type FieldPoAlert = {
  id: string;
  kind: "po_status";
  scheduleId: string;
  jobRef: string;
  customer: string;
  supplier: string;
  status: string;
  note: string;
  poNumber?: string;
  createdAt: string;
  updatedAt?: string;
  title: string;
  detail: string;
};

function fieldStatusLabel(status: string) {
  if (status === "Approved") return "Approved";
  if (status === "Rejected") return "Rejected";
  if (status === "Requested") return "Waiting office";
  if (status === "Pending cost" || status === "Issued" || status === "Draft") return "Ordered / with office";
  if (status === "Part received") return "Part received";
  if (status === "Received") return "Fully received";
  return status;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || undefined;
  const engineerId = resolveFieldEngineerId(request.headers, url.searchParams.get("engineerId") ?? undefined);
  const schedule = withLiveFieldDates(getEngineerSchedule(engineerId)).filter((item) =>
    date ? item.date === date : true,
  );
  const jobIds = new Set(schedule.map((item) => item.jobId).filter(Boolean));
  const jobRefs = new Set(schedule.map((item) => item.jobRef).filter(Boolean));

  // Also include recent POs for this engineer even if not on today's diary.
  const allSchedule = withLiveFieldDates(getEngineerSchedule(engineerId));
  const engineerJobIds = new Set(allSchedule.map((item) => item.jobId).filter(Boolean));
  const engineerJobRefs = new Set(allSchedule.map((item) => item.jobRef).filter(Boolean));

  const alerts: FieldPoAlert[] = getPurchaseRequests()
    .filter(
      (request) =>
        jobIds.has(request.jobId) ||
        jobRefs.has(request.jobRef) ||
        engineerJobIds.has(request.jobId) ||
        engineerJobRefs.has(request.jobRef),
    )
    .filter((request) => request.status !== "Requested" && request.status !== "Draft")
    .map((request) => {
      const job =
        schedule.find((item) => item.jobId === request.jobId || item.jobRef === request.jobRef) ||
        allSchedule.find((item) => item.jobId === request.jobId || item.jobRef === request.jobRef);
      const label = fieldStatusLabel(request.status);
      return {
        id: `po-alert-${request.id}-${request.status}`,
        kind: "po_status" as const,
        scheduleId: job?.scheduleId || "",
        jobRef: request.jobRef,
        customer: job?.customer || request.jobRef,
        supplier: request.supplier,
        status: request.status,
        note: request.reason || request.item || "",
        poNumber: request.poNumber || undefined,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        title:
          request.status === "Approved"
            ? "PO approved"
            : request.status === "Rejected"
              ? "PO rejected"
              : `PO ${label.toLowerCase()}`,
        detail: `${request.jobRef} · ${request.supplier}${request.poNumber ? ` · ${request.poNumber}` : ""}`,
      };
    })
    .sort((first, second) =>
      String(second.updatedAt || second.createdAt).localeCompare(String(first.updatedAt || first.createdAt)),
    )
    .slice(0, 12);

  return NextResponse.json({ alerts });
}
