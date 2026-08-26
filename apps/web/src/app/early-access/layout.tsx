import type { Metadata } from "next";

import { sora, sourceSans } from "./fonts";

export const metadata: Metadata = {
  title: "NeXa · Company Production Early Access",
  description:
    "One company package — Core, Survey, Takeoff, Heat Design and Field. Early access scope, terms, and how to start.",
  openGraph: {
    title: "NeXa · Company Production Early Access",
    description:
      "Paid early access to the full NeXa package: Core through Field, Ayla AI, backups, and a clear ops checklist.",
    url: "/early-access",
    siteName: "NeXa",
    type: "website",
    images: [{ url: "/app-icons/nexa-core-icon-512.png", width: 512, height: 512, alt: "NeXa" }],
  },
  twitter: {
    card: "summary",
    title: "NeXa · Company Production Early Access",
    description: "One company package — not a pile of project apps.",
    images: ["/app-icons/nexa-core-icon-512.png"],
  },
};

export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${sora.variable} ${sourceSans.variable}`}>{children}</div>;
}
