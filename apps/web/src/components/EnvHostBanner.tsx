"use client";

import { useEffect, useState } from "react";

type HostKind = "live" | "pilot" | "local" | "other";

function classifyHost(hostname: string): HostKind {
  const host = hostname.toLowerCase();
  if (host.includes("nexa-live")) return "live";
  if (host.includes("nexa-pilot")) return "pilot";
  if (host === "localhost" || host === "127.0.0.1") return "local";
  return "other";
}

/**
 * Pilot and Live are separate Render apps with separate SQLite disks.
 * Field saves on one never appear on the other — make the host impossible to miss.
 */
export function EnvHostBanner() {
  const [kind, setKind] = useState<HostKind | null>(null);
  const [host, setHost] = useState("");

  useEffect(() => {
    const hostname = window.location.hostname;
    setHost(hostname);
    setKind(classifyHost(hostname));
  }, []);

  if (!kind) return null;

  if (kind === "live") {
    return (
      <div
        role="status"
        style={{
          background: "#0f5f4b",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.02,
          padding: "8px 12px",
          textAlign: "center",
        }}
      >
        LIVE · nexa-live.onrender.com · Field and Core must both be on this URL
      </div>
    );
  }

  if (kind === "pilot") {
    return (
      <div
        role="status"
        style={{
          background: "#b45309",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.02,
          padding: "8px 12px",
          textAlign: "center",
        }}
      >
        PILOT · {host} · separate database from LIVE — Daywork saved here will not show on
        nexa-live.onrender.com
      </div>
    );
  }

  if (kind === "local") {
    return (
      <div
        role="status"
        style={{
          background: "#334155",
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          padding: "6px 12px",
          textAlign: "center",
        }}
      >
        LOCAL · {host}
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        background: "#7f1d1d",
        color: "#fff",
        fontSize: 12,
        fontWeight: 700,
        padding: "6px 12px",
        textAlign: "center",
      }}
    >
      Unknown host {host} — Daywork only syncs within the same hostname
    </div>
  );
}
