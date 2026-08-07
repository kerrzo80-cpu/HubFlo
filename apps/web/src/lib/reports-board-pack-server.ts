/**
 * Server-only board pack loader. Keep hub/workflow/sqlite imports out of
 * reports-board-pack.ts so Core page.tsx (client) can import PDF helpers safely.
 */
import { getHubDetailState } from "@/lib/hub-detail-store";
import {
  buildManagerBoardPackRows,
  type ManagerBoardPackResult,
  type ManagerBoardPackSnapshot,
} from "@/lib/reports-board-pack";
import { listVariationPortalRequests } from "@/lib/variation-portal-data";
import { getJobs } from "@/lib/workflow-data";

export function loadManagerBoardPackRows(options?: {
  asAt?: string;
}): ManagerBoardPackResult {
  const hub = getHubDetailState();
  const pending = listVariationPortalRequests().filter(
    (request) => request.status === "Pending" || request.status === "Viewed",
  );
  const snapshot: ManagerBoardPackSnapshot = {
    invoices: Array.isArray(hub.invoices) ? (hub.invoices as ManagerBoardPackSnapshot["invoices"]) : [],
    jobs: getJobs(),
    businessSettings:
      hub.businessSettings && typeof hub.businessSettings === "object"
        ? (hub.businessSettings as Record<string, unknown>)
        : undefined,
    variationPortalPending: pending.length,
    variationPortalSell: pending.reduce((total, request) => total + (Number(request.sellValue) || 0), 0),
  };
  return buildManagerBoardPackRows({
    asAt: options?.asAt,
    snapshot,
  });
}
