import type { Metadata } from "next";
import { AiFirstPrototype } from "./AiFirstPrototype";

export const metadata: Metadata = {
  title: "NeXa · AI-First",
  description:
    "Live AI spine — Heat Design + Takeoff handoff — plus the clickable intake→invoice prototype.",
};

export default function AiFirstPage() {
  return <AiFirstPrototype />;
}
