"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, Ruler } from "lucide-react";

const MODES = [
  {
    href: "/takeoff",
    label: "Quantity takeoff",
    detail: "Count fixtures & build BOQ",
    icon: Ruler,
    match: (path: string) => path === "/takeoff" || path === "/takeoff/",
  },
  {
    href: "/takeoff/routes",
    label: "Plumbing route design",
    detail: "Draw pipe runs on drawings",
    icon: Map,
    match: (path: string) => path.startsWith("/takeoff/routes") || path.startsWith("/takeoff/markup"),
  },
] as const;

export default function TakeoffModeNav({ variant = "skill" }: { variant?: "skill" | "markup" }) {
  const pathname = usePathname() || "/takeoff";

  return (
    <nav className={`takeoff-mode-nav ${variant}`} aria-label="Takeoff mode">
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const active = mode.match(pathname);
        return (
          <Link
            key={mode.href}
            href={mode.href}
            className={active ? "mode on" : "mode"}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={15} />
            <span>
              <strong>{mode.label}</strong>
              <small>{mode.detail}</small>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
