"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, Settings2 } from "lucide-react";

const links = [
  { href: "/", label: "My Day", icon: CalendarDays },
  { href: "/time-check", label: "Blake", icon: Clock3 },
  { href: "/settings", label: "Connect", icon: Settings2 },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="field-app">
      <header className="field-topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/nexa-command-mark.svg" alt="" aria-hidden="true" />
        <div>
          <strong>NeXa Field</strong>
          <span>Today&apos;s work</span>
        </div>
      </header>
      {children}
      <nav className="field-tabbar" aria-label="Field app">
        {links.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className={active ? "active" : undefined}>
              <Icon size={18} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
