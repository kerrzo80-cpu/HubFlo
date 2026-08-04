import type { Metadata } from "next";
import { Figtree } from "next/font/google";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-heat-design",
});

export const metadata: Metadata = {
  title: "Heat Design · NeXa",
  description: "Room-by-room heat loss, floor plan design, and heating system sizing.",
};

export default function HeatDesignLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${figtree.variable} ${figtree.className}`}>{children}</div>;
}
