"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { PublicTenantView } from "@/lib/tenancy/types";

type TenantBrandContextValue = {
  tenant: PublicTenantView | null;
  loading: boolean;
  error: string;
};

const TenantBrandContext = createContext<TenantBrandContextValue>({
  tenant: null,
  loading: true,
  error: "",
});

export function useTenantBrand() {
  return useContext(TenantBrandContext);
}

export function TenantBrandProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<PublicTenantView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tenant", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          tenant?: PublicTenantView;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.tenant) {
          setError(body.error || "Could not resolve company workspace.");
          setTenant(null);
          return;
        }
        setTenant(body.tenant);
        setError("");
      })
      .catch(() => {
        if (!cancelled) setError("Could not resolve company workspace.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tenant) return;
    const root = document.documentElement;
    root.style.setProperty("--tenant-primary", tenant.branding.primaryColor || "#157fa8");
    root.style.setProperty("--tenant-accent", tenant.branding.accentColor || "#0f5f7d");
    root.style.setProperty("--nexa-blue", tenant.branding.primaryColor || "#157fa8");
    root.style.setProperty("--ewg-blue", tenant.branding.primaryColor || "#157fa8");
  }, [tenant]);

  const value = useMemo(() => ({ tenant, loading, error }), [tenant, loading, error]);

  const style = {
    ["--tenant-primary" as string]: tenant?.branding.primaryColor || "#157fa8",
    ["--tenant-accent" as string]: tenant?.branding.accentColor || "#0f5f7d",
  } as CSSProperties;

  return (
    <TenantBrandContext.Provider value={value}>
      <div className="tenant-brand-root" style={style} data-tenant={tenant?.slug || ""}>
        {children}
      </div>
    </TenantBrandContext.Provider>
  );
}
