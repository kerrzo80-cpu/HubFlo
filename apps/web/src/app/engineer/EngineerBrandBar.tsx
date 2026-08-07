"use client";

import { useBrand } from "@/components/BrandProvider";
import { resolveBrandChromeLogoUrl } from "@/lib/branding";

/** Branded engineer chrome — owner wordmark, not the old NeXa mark. */
export function EngineerBrandBar() {
  const brand = useBrand();
  return (
    <header className="engineer-brand-bar" aria-label={`${brand.fieldAppName || brand.companyName} engineer app`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={resolveBrandChromeLogoUrl(brand, "field")} alt={brand.companyName} />
      <div className="engineer-brand-copy">
        <strong>{brand.fieldAppName || brand.companyName}</strong>
        <span>{brand.companyName}</span>
      </div>
    </header>
  );
}
