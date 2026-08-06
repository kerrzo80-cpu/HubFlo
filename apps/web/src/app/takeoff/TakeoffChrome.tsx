"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Map, Ruler, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type TakeoffMode = "quantity" | "routes";

const MODES: Array<{
  id: TakeoffMode;
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
}> = [
  {
    id: "quantity",
    href: "/takeoff",
    label: "Quantity",
    icon: Ruler,
    match: (path) => path === "/takeoff" || path === "/takeoff/",
  },
  {
    id: "routes",
    href: "/takeoff/routes",
    label: "Routes",
    icon: Map,
    match: (path) => path.startsWith("/takeoff/routes") || path.startsWith("/takeoff/markup"),
  },
];

type TakeoffChromeProps = {
  subtitle?: string;
  status?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
};

export default function TakeoffChrome({
  subtitle = "Takeoff",
  status,
  actions,
  compact = false,
}: TakeoffChromeProps) {
  const pathname = usePathname() || "/takeoff";

  return (
    <header className={`takeoff-chrome${compact ? " compact" : ""}`}>
      <div className="takeoff-chrome-left">
        <Link href="/" className="takeoff-chrome-back" aria-label="Back to Core">
          <ArrowLeft size={15} />
          <span>Core</span>
        </Link>
        <div className="takeoff-chrome-title">
          <strong>NeXa Takeoff</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>

      <nav className="takeoff-chrome-modes" aria-label="Takeoff mode">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = mode.match(pathname);
          return (
            <Link
              key={mode.id}
              href={mode.href}
              className={active ? "on" : undefined}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={14} />
              {mode.label}
            </Link>
          );
        })}
      </nav>

      <div className="takeoff-chrome-right">
        {status}
        {actions}
      </div>
    </header>
  );
}
