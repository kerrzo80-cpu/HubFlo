import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { EnvHostBanner } from "@/components/EnvHostBanner";
import { TenantBrandProvider } from "@/components/tenant/TenantBrandProvider";
import { PwaIconLinks } from "./pwa-icon-links";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-nexa",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://nexaapp.com"),
  title: "NeXa",
  description: "Multi-tenant field service command center.",
  applicationName: "NeXa",
  manifest: "/manifest-core.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NeXa",
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
  themeColor: "#157fa8",
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <TenantBrandProvider>
          <PwaIconLinks />
          <EnvHostBanner />
          {children}
        </TenantBrandProvider>
      </body>
    </html>
  );
}
