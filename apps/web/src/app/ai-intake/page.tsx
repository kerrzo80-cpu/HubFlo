import type { Metadata } from "next";
import { AiIntakeClient } from "./AiIntakeClient";

export const metadata: Metadata = {
  title: "Ayla · Create in Core",
  description:
    "Ayla creates a Lead, Quote, or Job from free-text work description, existing or new customers, and live UK postcode lookup.",
};

export default function AiIntakePage() {
  return <AiIntakeClient />;
}
