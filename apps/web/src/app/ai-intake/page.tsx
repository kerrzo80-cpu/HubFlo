import type { Metadata } from "next";
import { AiIntakeClient } from "./AiIntakeClient";

export const metadata: Metadata = {
  title: "NeXa · AI Intake",
  description: "Create a NeXa lead by telling NeXa what the customer needs, then book the surveyor.",
};

export default function AiIntakePage() {
  return <AiIntakeClient />;
}
