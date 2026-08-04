import type { Metadata, Viewport } from "next";
import { TakeoffScrollUnlock } from "./takeoff-scroll-unlock";

export const metadata: Metadata = {
  title: "NeXa Takeoffs",
  description: "AI construction quantity takeoff skill — primary/secondary quantities, confidence scoring, BOQ handoff.",
  applicationName: "NeXa Takeoffs",
  manifest: "/manifest-takeoffs.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NeXa Takeoffs",
  },
  icons: {
    icon: [
      { url: "/app-icons/nexa-takeoffs-icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/app-icons/nexa-takeoffs-icon-1024.png", sizes: "1024x1024", type: "image/png" },
    ],
    apple: [{ url: "/app-icons/nexa-takeoffs-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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
