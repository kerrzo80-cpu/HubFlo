import type { Metadata } from "next";

import { sora, sourceSans } from "./fonts";

export const metadata: Metadata = {
  title: "NeXa · Company Production Early Access",
  description:
    "NeXa as production for your company — early access scope, what’s included, and commercial terms.",
};

export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${sora.variable} ${sourceSans.variable}`}>{children}</div>;
}
