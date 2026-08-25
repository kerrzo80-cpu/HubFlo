import type { Metadata, Viewport } from "next";
import { EnvHostBanner } from "@/components/EnvHostBanner";
import "./train.css";

export const metadata: Metadata = {
  title: "Blake Trainer · Blake",
  description:
    "Voice-first AI trainer for Blake staff — role-aware modules, understanding checks, answers only from approved materials.",
  applicationName: "Blake Trainer",
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
