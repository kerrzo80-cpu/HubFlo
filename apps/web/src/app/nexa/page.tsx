import type { Metadata } from "next";

import { NexaSalesExperience } from "./sales-experience";

export const metadata: Metadata = {
  title: "NeXa | The AI operating system for service work",
  description:
    "Quote, schedule, deliver and invoice service work from one connected command centre, with Blake AI working across the full operation.",
};

export default function NexaSalesPage() {
  return <NexaSalesExperience />;
}
