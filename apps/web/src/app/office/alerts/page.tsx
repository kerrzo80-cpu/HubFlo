import { headers } from "next/headers";

import { getOfficeAlerts, getOfficePoRequests } from "@/lib/engineer-data";
import { getJobAttentionAlerts } from "@/lib/job-office-updates";
import OfficeAlertsClient from "./OfficeAlertsClient";

export default async function OfficeAlertsPage() {
  const requestHeaders = await headers();
  const tenantId = requestHeaders.get("x-hubflo-tenant-id") || "default";
  return (
    <OfficeAlertsClient
      alerts={[...getJobAttentionAlerts(tenantId), ...getOfficeAlerts()]}
      poRequests={getOfficePoRequests()}
    />
  );
}
