"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, RefreshCw } from "lucide-react";
import { useBrand } from "@/components/BrandProvider";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import { resolveBrandChromeLogoUrl } from "@/lib/branding";
import { countPendingOutbox, flushOutbox, subscribeOutbox } from "@/lib/field/offline-outbox";
import { FIELD_BASE, fieldPath } from "@/lib/field/routes";

/** Site Field chrome — My Day / Ask Blake / Hours only (no Connect / Talk). */
const links = [
  { href: fieldPath("/"), label: "My Day", kind: "icon" as const, icon: CalendarDays },
  { href: fieldPath("/ask"), label: "Ask Blake", kind: "blake" as const },
  { href: fieldPath("/time-check"), label: "Hours", kind: "icon" as const, icon: Clock3 },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const brand = useBrand();
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeOutbox((items) => setPendingSyncCount(countPendingOutbox(items)));
    void flushOutbox();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    void (async () => {
      try {
        // Tear down the Phase 3 root-scoped SW that could poison /_next after deploys.
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          regs.map(async (reg) => {
            const script =
              reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || "";
            if (script.endsWith("/sw-field.js")) await reg.unregister();
          }),
        );
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((key) => key.startsWith("ewg-field-shell-") && key !== "ewg-field-shell-v5")
              .map((key) => caches.delete(key)),
          );
        }
        await navigator.serviceWorker.register("/field/sw.js", { scope: "/field/" });
      } catch {
        // Private mode / unsupported — Field still works online with outbox.
      }
    })();
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
          src={resolveBrandChromeLogoUrl(brand, "field")}
          alt={brand.companyName}
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
          return (
            <Link
              key={link.href}
              href={link.href}
              className={[active ? "active" : "", link.kind === "blake" ? "is-blake" : ""]
                .filter(Boolean)
                .join(" ") || undefined}
            >
              {link.kind === "blake" ? (
                <span className="field-tabbar-blake" aria-hidden>
                  <BlakeCharacter mood={active ? "good" : "idle"} size="sm" />
                </span>
              ) : (
                <link.icon size={18} />
              )}
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
