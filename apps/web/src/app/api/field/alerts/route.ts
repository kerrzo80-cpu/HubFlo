import { NextResponse } from "next/server";

import { getEngineerSchedule } from "@/lib/engineer-data";
import { resolveFieldEngineerId } from "@/lib/field/field-scope";
import { withLiveFieldDates } from "@/lib/field/nexa/from-core";
import { getPurchaseRequests, isoDateFromWorkflowTimestamp } from "@/lib/workflow-data";

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
  statusChangedOn: string;
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

function alertDayForRequest(request: {
  statusChangedOn?: string;
  updatedAt?: string;
  createdAt: string;
  status: string;
}) {
  if (request.statusChangedOn && /^\d{4}-\d{2}-\d{2}$/.test(request.statusChangedOn)) {
    return request.statusChangedOn;
  }
  return (
    isoDateFromWorkflowTimestamp(request.updatedAt) ||
    isoDateFromWorkflowTimestamp(request.createdAt) ||
    ""
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const engineerId = resolveFieldEngineerId(request.headers, url.searchParams.get("engineerId") ?? undefined);
  const allSchedule = withLiveFieldDates(getEngineerSchedule(engineerId));
  const engineerJobIds = new Set(allSchedule.map((item) => item.jobId).filter(Boolean));
  const engineerJobRefs = new Set(allSchedule.map((item) => item.jobRef).filter(Boolean));

  const alerts: FieldPoAlert[] = getPurchaseRequests()
    .filter(
      (item) => engineerJobIds.has(item.jobId) || engineerJobRefs.has(item.jobRef),
    )
    // Only surface status changes — not open drafts / waiting requests.
    .filter((item) => item.status !== "Requested" && item.status !== "Draft")
    // Show on the approval / status-change day only, then drop off following days.
    .filter((item) => alertDayForRequest(item) === date)
    .map((item) => {
      const job = allSchedule.find((row) => row.jobId === item.jobId || row.jobRef === item.jobRef);
      const label = fieldStatusLabel(item.status);
      const statusChangedOn = alertDayForRequest(item);
      return {
        id: `po-alert-${item.id}-${item.status}-${statusChangedOn}`,
        kind: "po_status" as const,
        scheduleId: job?.scheduleId || "",
        jobRef: item.jobRef,
        customer: job?.customer || item.jobRef,
        supplier: item.supplier,
        status: item.status,
        note: item.reason || item.item || "",
        poNumber: item.poNumber || undefined,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        statusChangedOn,
        title:
          item.status === "Approved"
            ? "PO approved"
            : item.status === "Rejected"
              ? "PO rejected"
              : `PO ${label.toLowerCase()}`,
        detail: `${item.jobRef} · ${item.supplier}${item.poNumber ? ` · ${item.poNumber}` : ""}`,
      };
    })
    .sort((first, second) =>
      String(second.updatedAt || second.createdAt).localeCompare(String(first.updatedAt || first.createdAt)),
    )
    .slice(0, 12);

  return NextResponse.json({ alerts, date });
}
