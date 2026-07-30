import type { Metadata } from "next";
import { AiIntakeClient } from "./AiIntakeClient";

export const metadata: Metadata = {
  title: "NeXa · Blake AI Intake",
  description: "Blake creates a NeXa lead from job type and contact details, then books the surveyor.",
};

export default function AiIntakePage() {
  return <AiIntakeClient />;
}
