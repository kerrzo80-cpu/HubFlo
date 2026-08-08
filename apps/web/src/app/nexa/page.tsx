import type { Metadata } from "next";

import { NexaSalesExperience } from "./sales-experience";

export const metadata: Metadata = {
  title: "NeXa | Company production for service work",
  description:
    "Quote, survey, schedule, deliver and invoice from one connected command centre. Company production early access for named operators.",
};

export default function NexaSalesPage() {
  return <NexaSalesExperience />;
}
