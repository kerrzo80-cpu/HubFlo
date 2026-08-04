import type { Metadata, Viewport } from "next";
import { AppChrome } from "@/components/field/AppChrome";
import { NexaClientProvider } from "@/lib/field/nexa";
import "./field.css";

export const metadata: Metadata = {
  title: "EWG Field",
  description: "Errol Watson Group field app for plumbers and joiners — schedule, job packs, and Blake hours.",
  applicationName: "EWG Field",
  manifest: "/manifest-field.json",
  appleWebApp: {
    capable: true,
    title: "EWG Field",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/ewg-logo.png",
    apple: "/ewg-logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2E8C7D",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function FieldLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <NexaClientProvider>
      <AppChrome>{children}</AppChrome>
    </NexaClientProvider>
  );
}
