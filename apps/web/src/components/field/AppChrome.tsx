"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, MessageCircle } from "lucide-react";
import { FIELD_BASE, fieldPath } from "@/lib/field/routes";

const links = [
  { href: fieldPath("/"), label: "My Day", icon: CalendarDays },
  { href: fieldPath("/ask"), label: "Ask Blake", icon: MessageCircle },
  { href: fieldPath("/time-check"), label: "Hours", icon: Clock3 },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="field-app">
      <header className="field-topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ewg-logo.png" alt="Errol Watson Group" />
        <div>
          <strong>EWG Field</strong>
          <span>Errol Watson Group</span>
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
