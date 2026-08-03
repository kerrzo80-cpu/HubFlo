import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Heat Design Lab · NeXa",
  description: "Standalone heat-pump design lab — room heat loss, sizing, and savings. Not linked into NeXa yet.",
};

export default function HeatDesignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
