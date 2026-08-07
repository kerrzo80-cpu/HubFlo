import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { updateJob } from "@/lib/workflow-data";
import type { VariationPortalRecord } from "@/lib/variation-portal-data";

export type VariationPortalHandoffResult = {
  eventUpdated: boolean;
  jobNextUpdated: boolean;
  sellApplied: number;
};

function asDeliveryEvents(hubState: ReturnType<typeof getHubDetailState>) {
  return Array.isArray(hubState.jobDeliveryEvents)
    ? ([...hubState.jobDeliveryEvents] as Array<Record<string, unknown>>)
    : [];
}

function mapPortalStatusToEventStatus(status: VariationPortalRecord["status"]) {
  if (status === "Approved") return "Client approved";
  if (status === "Declined") return "Rejected";
  return "Sent for approval";
}

function mapPortalStatusToClientStatus(status: VariationPortalRecord["status"]) {
  if (status === "Approved") return "Approved";
  if (status === "Declined") return "Declined";
  if (status === "Viewed") return "Viewed";
  return "Sent";
}

export function applyVariationPortalHandoff(record: VariationPortalRecord): VariationPortalHandoffResult {
  const hubState = getHubDetailState();
  const events = asDeliveryEvents(hubState);
  const eventIndex = events.findIndex(
    (event) =>
      event.id === record.variationEventId &&
      event.jobId === record.jobId &&
      event.kind === "variation",
  );

  const sellValue = Number(record.sellValue) || 0;
  const nextStatus = mapPortalStatusToEventStatus(record.status);
  const nextClientStatus = mapPortalStatusToClientStatus(record.status);

  let eventUpdated = false;
  if (eventIndex >= 0) {
    const current = events[eventIndex];
    events[eventIndex] = {
      ...current,
      status: nextStatus,
      clientApprovalStatus: nextClientStatus,
      sellValue: sellValue > 0 ? sellValue : current.sellValue,
      portalToken: record.token,
    };
    eventUpdated = true;
  }

  saveHubDetailState({
    ...hubState,
    jobDeliveryEvents: events,
  });

  let jobNextUpdated = false;
  if (record.status === "Approved") {
    const nextMessage = `${record.summary} approved by client online. Ready to proceed.`;
    const patched = updateJob(record.jobId, { next: nextMessage });
    jobNextUpdated = Boolean(patched);
  } else if (record.status === "Declined") {
    const nextMessage = `${record.summary} declined by client online. Review and follow up.`;
    const patched = updateJob(record.jobId, { next: nextMessage });
    jobNextUpdated = Boolean(patched);
  }

  return {
    eventUpdated,
    jobNextUpdated,
    sellApplied: sellValue,
  };
}
