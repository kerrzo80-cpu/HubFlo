import { getOfficeAlerts, getOfficePoRequests } from "@/lib/engineer-data";
import OfficeAlertsClient from "./OfficeAlertsClient";

export default function OfficeAlertsPage() {
  return (
    <OfficeAlertsClient
      alerts={getOfficeAlerts()}
      poRequests={getOfficePoRequests()}
    />
  );
}
