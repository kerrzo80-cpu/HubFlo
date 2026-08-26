import type { Metadata } from "next";

import { NexaSalesExperience } from "./sales-experience";

export const metadata: Metadata = {
  title: "blake. | Your AI Office Manager",
  description:
    "Quote, schedule, deliver and invoice service work from one connected command centre, with Ask Ayla working across the full operation.",
};

export default function NexaSalesPage() {
  return <NexaSalesExperience />;
}
