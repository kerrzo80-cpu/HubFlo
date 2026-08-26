import type { Metadata } from "next";

import { ASSISTANT_ASK, ASSISTANT_NAME, PLATFORM_NAME } from "@/lib/product-brand";
import BlakeChatPage from "./BlakeChatPage";
import launcherStyles from "./drive-launcher.module.css";

export const metadata: Metadata = {
  title: `${ASSISTANT_ASK} | ${PLATFORM_NAME}`,
  description: `Ask ${ASSISTANT_NAME} anything about your authorised NeXa workspace.`,
};

export default function BlakePage() {
  return (
    <>
      <BlakeChatPage />
      <a href="/blake/knowledge" className={launcherStyles.knowledge}>{ASSISTANT_NAME} Knowledge</a>
      <a href="/blake/drive" className={launcherStyles.launcher}>Driving Mode</a>
    </>
  );
}
