"use client";

import { useEffect } from "react";

/** Opt Takeoff into an independent mobile scrollport outside the Core shell. */
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
