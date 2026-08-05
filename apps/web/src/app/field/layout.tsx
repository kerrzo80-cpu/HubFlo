import type { Metadata, Viewport } from "next";
import { AppChrome } from "@/components/field/AppChrome";
import { NexaClientProvider } from "@/lib/field/nexa";
import "./field.css";

export const metadata: Metadata = {
  title: "Field",
  description: "Field app for plumbers and joiners — schedule, job packs, and hours.",
  applicationName: "Field",
  manifest: "/api/manifest/field",
  appleWebApp: {
    capable: true,
    title: "Field",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/api/branding/assets/logo-field",
    apple: "/api/branding/assets/logo-field",
  },
};

export const viewport: Viewport = {
  themeColor: "#157fa8",
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
