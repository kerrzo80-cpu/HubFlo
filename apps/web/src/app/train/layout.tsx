import type { Metadata, Viewport } from "next";
import { EnvHostBanner } from "@/components/EnvHostBanner";
import { PLATFORM_NAME, TRAINER_APP_NAME } from "@/lib/product-brand";
import "./train.css";

export const metadata: Metadata = {
  title: `${TRAINER_APP_NAME} · ${PLATFORM_NAME}`,
  description:
    "Voice-first AI trainer for Blake staff — role-aware modules, understanding checks, answers only from approved materials.",
  applicationName: TRAINER_APP_NAME,
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
