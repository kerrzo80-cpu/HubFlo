"use client";

import { useEffect } from "react";

/**
 * Keep Takeoff outside the Core shell scroll lock.
 * Non-markup tabs scroll on `.takeoff-app.takeoff-page-scroll`;
 * markup keeps its own fullscreen viewport.
 */
export function TakeoffScrollUnlock() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add("nexa-takeoff-scroll");
    body.classList.add("nexa-takeoff-scroll");
    return () => {
      root.classList.remove("nexa-takeoff-scroll");
      body.classList.remove("nexa-takeoff-scroll");
    };
  }, []);

  return null;
}
