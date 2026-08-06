import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-heat-design",
});

export const metadata: Metadata = {
  title: "Heat Design",
  description: "Live heat design — floor plans, system sizing, and materials into Core quotes or jobs.",
  applicationName: "Heat Design",
  manifest: "/api/manifest/heat-design",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Heat Design",
  },
  icons: {
    icon: [
      { url: "/icon", sizes: "32x32", type: "image/png" },
      { url: "/api/branding/assets/logo-heat-design?home=1&v=tab1", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/api/branding/assets/logo-heat-design?apple=1&v=tab1", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#157fa8",
};

export default function HeatDesignLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${figtree.variable} ${figtree.className}`}>{children}</div>;
}
