import type { Metadata, Viewport } from "next";
import { PwaIconLinks } from "./pwa-icon-links";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://nexa-pilot.onrender.com"),
  title: "NeXa Core",
  description: "Bound into one command center for service operations.",
  applicationName: "NeXa Core",
  manifest: "/manifest-core.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NeXa Core",
  },
  icons: {
    icon: [
      { url: "/app-icons/nexa-core-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/app-icons/nexa-core-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#006eb8",
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PwaIconLinks />
        {children}
      </body>
    </html>
  );
}
