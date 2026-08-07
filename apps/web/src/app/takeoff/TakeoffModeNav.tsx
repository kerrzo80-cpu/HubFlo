"use client";

import TakeoffChrome from "./TakeoffChrome";

/** Thin mode switcher used only if something still imports the old nav. Prefer TakeoffChrome. */
export default function TakeoffModeNav(_props: { variant?: "skill" | "markup" }) {
  return <TakeoffChrome subtitle="Takeoff" />;
}
