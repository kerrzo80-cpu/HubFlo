"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, MessageCircle, RefreshCw } from "lucide-react";
import { useBrand } from "@/components/BrandProvider";
import { resolveBrandLogoUrl } from "@/lib/branding";
import { flushOutbox, subscribeOutbox } from "@/lib/field/offline-outbox";
import { FIELD_BASE, fieldPath } from "@/lib/field/routes";

const links = [
  { href: fieldPath("/"), label: "My Day", icon: CalendarDays },
  { href: fieldPath("/ask"), label: "Ask Blake", icon: MessageCircle },
  { href: fieldPath("/time-check"), label: "Hours", icon: Clock3 },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const brand = useBrand();
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeOutbox((items) => setPendingSyncCount(items.length));
    void flushOutbox();
    return unsubscribe;
  }, []);

  async function syncNow() {
    setSyncing(true);
    try {
      await flushOutbox();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div
      className="field-app"
      style={
        {
          ["--teal" as string]: brand.brandPrimaryColor,
          ["--teal-soft" as string]: "color-mix(in srgb, var(--teal) 12%, white)",
        } as React.CSSProperties
      }
    >
      <header className="field-topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolveBrandLogoUrl(brand, "field")}
          alt={brand.companyName}
          style={{ background: "#fff" }}
        />
        <div>
          <strong>{brand.fieldAppName}</strong>
          <span>{brand.companyName}</span>
        </div>
        {pendingSyncCount > 0 ? (
          <div className="field-sync-pill" role="status" aria-live="polite">
            <span>{pendingSyncCount} pending sync</span>
            <button type="button" disabled={syncing} onClick={() => void syncNow()}>
              <RefreshCw size={13} />
              {syncing ? "Syncing" : "Sync now"}
            </button>
          </div>
        ) : null}
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
