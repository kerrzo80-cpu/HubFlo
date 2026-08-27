import type { Metadata } from "next";
import { AiFirstPrototype } from "./AiFirstPrototype";

export const metadata: Metadata = {
  title: "Blake · AI-First Prototype",
  description:
    "Clickable front-end prototype of Blake’s AI-first workflow — intake to invoice with human approval.",
};

export default function AiFirstPage() {
  return <AiFirstPrototype />;
}
