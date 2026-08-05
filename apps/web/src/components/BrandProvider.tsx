"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  applyBrandCssVariables,
  defaultBusinessBrandingSettings,
  toPublicBranding,
  type PublicBranding,
} from "@/lib/branding";

const BrandContext = createContext<PublicBranding>(toPublicBranding(defaultBusinessBrandingSettings));

export function useBrand() {
  return useContext(BrandContext);
}

export function BrandProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Optional seed from Core once hub-state is loaded. */
  initial?: Partial<PublicBranding> | null;
}) {
  const [brand, setBrand] = useState<PublicBranding>(() =>
    toPublicBranding({ ...defaultBusinessBrandingSettings, ...(initial || {}) }),
  );

  useEffect(() => {
    if (initial) {
      setBrand(toPublicBranding({ ...defaultBusinessBrandingSettings, ...initial }));
    }
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/branding", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { branding?: PublicBranding };
        if (!cancelled && body.branding) setBrand(toPublicBranding(body.branding));
      } catch {
        // Keep defaults when offline / unauthenticated edge cases.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyBrandCssVariables(brand);
  }, [brand]);

  const value = useMemo(() => brand, [brand]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}
