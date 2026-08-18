import type { Metadata } from "next";

import { NexaSalesExperience } from "./sales-experience";

export const metadata: Metadata = {
  title: "NeXa | All-in-one ops package for service work",
  description:
    "Core, Survey, Takeoff, Heat Design and Field in one company package — quote to cash on one live record.",
  openGraph: {
    title: "NeXa | All-in-one ops package for service work",
    description:
      "One package, not five tools: Core, Survey, Takeoff, Heat Design and Field for service work.",
    url: "/nexa",
    siteName: "NeXa",
    type: "website",
    images: [{ url: "/app-icons/nexa-core-icon-512.png", width: 512, height: 512, alt: "NeXa" }],
  },
  twitter: {
    card: "summary",
    title: "NeXa | All-in-one ops package for service work",
    description: "Core, Survey, Takeoff, Heat Design and Field — one live record.",
    images: ["/app-icons/nexa-core-icon-512.png"],
  },
};

export default function NexaSalesPage() {
  return <NexaSalesExperience />;
}
