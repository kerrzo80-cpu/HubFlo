import type { Metadata } from "next";

import BlakeChatPage from "./BlakeChatPage";

export const metadata: Metadata = {
  title: "Blake | NeXa",
  description: "Your AI operating layer for NeXa.",
};

export default function BlakePage() {
  return <BlakeChatPage />;
}
