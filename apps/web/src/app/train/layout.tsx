import type { Metadata, Viewport } from "next";
import { EnvHostBanner } from "@/components/EnvHostBanner";
import "./train.css";

export const metadata: Metadata = {
  title: "Blake Trainer · NeXa",
  description:
    "Voice-first AI trainer for NeXa staff — role-aware modules, understanding checks, answers only from approved materials.",
  applicationName: "Blake Trainer",
};

export const viewport: Viewport = {
  themeColor: "#202A36",
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
