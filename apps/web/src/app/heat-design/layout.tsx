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
  description: "Live heat design — floor plans, system sizing, and materials into Core quotes or jobs.",
};

export default function HeatDesignLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${figtree.variable} ${figtree.className}`}>{children}</div>;
}
