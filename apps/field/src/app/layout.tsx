import type { Metadata, Viewport } from "next";
import { AppChrome } from "@/components/AppChrome";
import { NexaClientProvider } from "@/lib/nexa";
import "./globals.css";

export const metadata: Metadata = {
  title: "NeXa Field",
  description: "Field app for plumbers and joiners — schedule, job packs, and Blake time checks.",
  applicationName: "NeXa Field",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "NeXa Field",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/brand/nexa-favicon.svg",
    apple: "/brand/nexa-command-mark.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#2E8C7D",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Sora:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NexaClientProvider>
          <AppChrome>{children}</AppChrome>
        </NexaClientProvider>
      </body>
    </html>
  );
}
