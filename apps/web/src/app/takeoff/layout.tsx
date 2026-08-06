import type { Metadata, Viewport } from "next";
import { TakeoffScrollUnlock } from "./takeoff-scroll-unlock";

export const metadata: Metadata = {
  title: "Takeoffs",
  description: "NeXa Takeoff Studio — AI area, linear and count takeoff with Core quote push.",
  applicationName: "Takeoffs",
  manifest: "/api/manifest/takeoffs",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Takeoffs",
  },
  icons: {
    icon: [
      { url: "/api/branding/favicon?size=32&v=tab4", sizes: "32x32", type: "image/png" },
      { url: "/api/branding/assets/logo-takeoffs?home=1&v=compose5", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/api/branding/assets/logo-takeoffs?apple=1&v=compose5", sizes: "180x180", type: "image/png" }],
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
