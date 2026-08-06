import type { Metadata, Viewport } from "next";
import { TakeoffScrollUnlock } from "./takeoff-scroll-unlock";

export const metadata: Metadata = {
  title: "Takeoffs",
  description: "AI construction quantity takeoff — quantities, confidence scoring, BOQ handoff.",
  applicationName: "Takeoffs",
  manifest: "/api/manifest/takeoffs",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Takeoffs",
  },
  icons: {
    icon: [
      { url: "/icon", sizes: "32x32", type: "image/png" },
      { url: "/api/branding/assets/logo-takeoffs?home=1&v=tab1", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/api/branding/assets/logo-takeoffs?apple=1&v=tab1", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function TakeoffLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <TakeoffScrollUnlock />
      {children}
    </>
  );
}
