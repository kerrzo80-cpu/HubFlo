import type { Metadata } from "next";

import { sora, sourceSans } from "./fonts";

export const metadata: Metadata = {
  title: "NeXa · Company Production Early Access",
  description:
    "NeXa as production for your company — early access scope, what’s included, commercial terms, and how to start.",
  openGraph: {
    title: "NeXa · Company Production Early Access",
    description:
      "Paid early access for a named company: live ops spine, Blake AI, backups, and a clear ops checklist.",
    url: "/early-access",
    siteName: "NeXa",
    type: "website",
    images: [{ url: "/app-icons/nexa-core-icon-512.png", width: 512, height: 512, alt: "NeXa" }],
  },
  twitter: {
    card: "summary",
    title: "NeXa · Company Production Early Access",
    description: "Production for your company — not a generic SaaS launch.",
    images: ["/app-icons/nexa-core-icon-512.png"],
  },
};

export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${sora.variable} ${sourceSans.variable}`}>{children}</div>;
}
