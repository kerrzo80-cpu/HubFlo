import type { Metadata } from "next";

import { NexaSalesExperience } from "./sales-experience";

export const metadata: Metadata = {
  title: "NeXa | Company production for service work",
  description:
    "Quote, survey, schedule, deliver and invoice from one connected command centre. Company production early access for named operators.",
  openGraph: {
    title: "NeXa | Company production for service work",
    description:
      "One live command centre for quote, survey, schedule, deliver and invoice — with Blake across the operation.",
    url: "/nexa",
    siteName: "NeXa",
    type: "website",
    images: [{ url: "/app-icons/nexa-core-icon-512.png", width: 512, height: 512, alt: "NeXa" }],
  },
  twitter: {
    card: "summary",
    title: "NeXa | Company production for service work",
    description: "Quote to cash from one live command centre.",
    images: ["/app-icons/nexa-core-icon-512.png"],
  },
};

export default function NexaSalesPage() {
  return <NexaSalesExperience />;
}
