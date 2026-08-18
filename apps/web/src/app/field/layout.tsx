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
    icon: [
      { url: "/api/branding/favicon?size=32&v=tab4", sizes: "32x32", type: "image/png" },
      { url: "/api/branding/assets/logo-field?home=1&v=compose5", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/api/branding/assets/logo-field?apple=1&v=compose5", sizes: "180x180", type: "image/png" }],
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
