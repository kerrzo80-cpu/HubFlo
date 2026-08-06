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
    icon: [{ url: "/api/branding/assets/logo-core?home=1&v=compose4", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/api/branding/assets/logo-core?apple=1&v=compose4", sizes: "180x180", type: "image/png" }],
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
