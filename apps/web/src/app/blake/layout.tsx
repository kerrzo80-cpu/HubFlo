import type { Metadata, Viewport } from "next";

import { ASSISTANT_ASK, PLATFORM_NAME } from "@/lib/product-brand";

export const metadata: Metadata = {
  title: `${ASSISTANT_ASK} | ${PLATFORM_NAME}`,
  description: "Your conversational AI office manager connected to Blake.",
  applicationName: ASSISTANT_ASK,
  manifest: "/api/manifest/ayla",
  appleWebApp: {
    capable: true,
    title: ASSISTANT_ASK,
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/api/branding/favicon?size=32&v=ayla1", sizes: "32x32", type: "image/png" },
      { url: "/api/branding/assets/logo-core?home=1&v=ayla1", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/api/branding/assets/logo-core?apple=1&v=ayla1", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#157fa8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function AylaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
