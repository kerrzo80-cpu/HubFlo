"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TrainChrome({
  children,
  subtitle = "Voice-first staff trainer",
}: {
  children: React.ReactNode;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const links = [
    { href: "/train", label: "Train", exact: true },
    { href: "/train/admin", label: "Admin" },
    { href: "/field", label: "Field" },
    { href: "/", label: "Core" },
  ];

  return (
    <div className="blake-train-shell">
      <header className="blake-train-top">
        <div className="blake-train-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/blake-mark.svg" alt="" aria-hidden="true" />
          <div>
            <strong>Blake · Blake Trainer</strong>
            <span>{subtitle}</span>
          </div>
        </div>
        <nav className="blake-train-nav" aria-label="Trainer">
          {links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} className={active ? "active" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </div>
  );
}
