import type { Metadata, Viewport } from "next";
import { EnvHostBanner } from "@/components/EnvHostBanner";
import "./train.css";

export const metadata: Metadata = {
  title: "Trainer",
  description:
    "Voice-first AI trainer for staff — role-aware modules, understanding checks, answers only from approved materials.",
  applicationName: "Trainer",
  manifest: "/api/manifest/trainer",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Trainer",
  },
  icons: {
    icon: [{ url: "/api/branding/assets/logo-trainer", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/api/branding/assets/logo-trainer", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#157fa8",
  width: "device-width",
  initialScale: 1,
};

export default function TrainLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <EnvHostBanner />
      <div className="blake-train">{children}</div>
    </>
  );
}
