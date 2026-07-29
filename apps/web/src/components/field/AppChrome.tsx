"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, MessageCircle, Settings2 } from "lucide-react";
import { FIELD_BASE, fieldPath } from "@/lib/field/routes";

const links = [
  { href: fieldPath("/"), label: "My Day", icon: CalendarDays },
  { href: fieldPath("/ask"), label: "Ask Blake", icon: MessageCircle },
  { href: fieldPath("/time-check"), label: "Hours", icon: Clock3 },
  { href: fieldPath("/settings"), label: "Connect", icon: Settings2 },
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
          const active =
            link.href === FIELD_BASE
              ? pathname === FIELD_BASE || pathname === `${FIELD_BASE}/`
              : pathname.startsWith(link.href);
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
