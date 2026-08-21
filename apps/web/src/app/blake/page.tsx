import type { Metadata } from "next";

import BlakeChatPage from "./BlakeChatPage";
import launcherStyles from "./drive-launcher.module.css";

export const metadata: Metadata = {
  title: "Blake | NeXa",
  description: "Your AI operating layer for NeXa.",
};

export default function BlakePage() {
  return (
    <>
      <BlakeChatPage />
      <a href="/blake/drive" className={launcherStyles.launcher}>Driving Mode</a>
    </>
  );
}
