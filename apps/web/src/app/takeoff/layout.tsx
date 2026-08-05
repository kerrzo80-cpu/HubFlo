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
    icon: [{ url: "/api/branding/assets/icon", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/api/branding/assets/icon", sizes: "180x180", type: "image/png" }],
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
