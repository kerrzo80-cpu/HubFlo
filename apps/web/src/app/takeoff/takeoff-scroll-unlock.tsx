"use client";

import { useEffect } from "react";

/**
 * Mark Takeoff as a standalone app outside the Core shell.
 * Documents / BoQ / Handoff scroll via CSS on html/body when
 * `.takeoff-page-scroll` is present; markup keeps a locked viewport.
 */
export function TakeoffScrollUnlock() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add("nexa-takeoff-scroll");
    body.classList.add("nexa-takeoff-scroll");
    return () => {
      root.classList.remove("nexa-takeoff-scroll", "nexa-takeoff-page-scroll");
      body.classList.remove("nexa-takeoff-scroll", "nexa-takeoff-page-scroll");
    };
  }, []);

  return null;
}
