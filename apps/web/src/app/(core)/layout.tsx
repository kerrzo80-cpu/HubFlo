"use client";

import type { ReactNode } from "react";
import CoreApp from "../CoreApp";

/**
 * Singleton Core shell — one CoreApp instance for all module URLs.
 * Thin child pages only exist so /jobs, /quotes, etc. are real App Router routes;
 * navigating between them must not remount hub state.
 */
export default function CoreShellLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CoreApp />
      {children}
    </>
  );
}
