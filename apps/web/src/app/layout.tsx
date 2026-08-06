import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { BrandProvider } from "@/components/BrandProvider";
import { PwaIconLinks } from "./pwa-icon-links";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-nexa",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://nexa-live.onrender.com"),
  title: "Core",
  description: "Bound into one command center for service operations.",
  applicationName: "Core",
  manifest: "/api/manifest/core",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Core",
  },
  icons: {
    icon: [
      { url: "/api/branding/favicon?size=32&v=tab3", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico", sizes: "32x32", type: "image/png" },
      { url: "/api/branding/assets/logo-core?v=tab3", sizes: "192x192", type: "image/png" },
      { url: "/api/branding/assets/logo-core?v=tab3", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/api/branding/favicon?size=180&v=tab3", sizes: "180x180", type: "image/png" }],
    shortcut: "/api/branding/favicon?size=32&v=tab3",
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
        <BrandProvider>
          <PwaIconLinks />
          {children}
        </BrandProvider>
      </body>
    </html>
  );
}
