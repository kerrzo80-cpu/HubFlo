import type { Metadata, Viewport } from "next";
import { AppChrome } from "@/components/field/AppChrome";
import { NexaClientProvider } from "@/lib/field/nexa";
import "./field.css";

export const metadata: Metadata = {
  title: "NeXa Field",
  description: "Field app for plumbers and joiners — schedule, job packs, and Blake time checks.",
  applicationName: "NeXa Field",
  manifest: "/manifest-field.json",
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

export default function FieldLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <NexaClientProvider>
      <AppChrome>{children}</AppChrome>
    </NexaClientProvider>
  );
}
