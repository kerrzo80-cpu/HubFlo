import type { Metadata } from "next";
import { AiIntakeClient } from "./AiIntakeClient";

export const metadata: Metadata = {
  title: "NeXa · Blake AI Intake",
  description:
    "Blake creates a NeXa Lead, Quote, or Job from the same job-type and contact intake.",
};

export default function AiIntakePage() {
  return <AiIntakeClient />;
}
