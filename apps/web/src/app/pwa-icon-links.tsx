"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import {
  appDisplayName,
  defaultBusinessBrandingSettings,
  resolveBrandIconUrl,
  toPublicBranding,
  type BrandAppKey,
  type PublicBranding,
} from "@/lib/branding";
import { useBrand } from "@/components/BrandProvider";

const iconVersion = "20260806g";

type Profile = {
  app: BrandAppKey;
  title: string;
  manifest: string;
  icon: string;
  themeColor: string;
};

function withVersion(path: string) {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}v=${iconVersion}`;
}

/** Swap home=1 → apple=1 for 180×180 apple-touch derivatives. */
function toAppleTouchHref(iconPath: string) {
  if (!iconPath.includes("/api/branding/assets/")) return iconPath;
  const [base, query = ""] = iconPath.split("?");
  const params = new URLSearchParams(query);
  params.delete("home");
  params.set("apple", "1");
  return `${base}?${params.toString()}`;
}

function upsertMeta(name: string, content: string) {
  const selector = `meta[name="${name}"]`;
  const meta = document.head.querySelector<HTMLMetaElement>(selector) ?? document.createElement("meta");
  meta.name = name;
  meta.content = content;
  if (!meta.parentElement) document.head.appendChild(meta);
}

function upsertLink(rel: string, href: string, options: { sizes?: string; type?: string } = {}) {
  const link =
    document.head.querySelector<HTMLLinkElement>(`link[data-nexa-pwa="${rel}"]`) ?? document.createElement("link");
  link.rel = rel;
  link.href = href;
  link.dataset.nexaPwa = rel;
  if (options.sizes) link.sizes = options.sizes;
  if (options.type) link.type = options.type;
  if (!link.parentElement) document.head.appendChild(link);
}

function chooseApp(pathname: string): BrandAppKey {
  if (pathname.startsWith("/takeoff")) return "takeoffs";
  if (pathname.startsWith("/field")) return "field";
  if (pathname.startsWith("/heat-design")) return "heat-design";
  if (pathname.startsWith("/train")) return "trainer";
  if (pathname.startsWith("/estimator") || pathname.startsWith("/survey")) return "survey";
  return "core";
}

function buildProfile(pathname: string, brand: PublicBranding): Profile {
  const app = chooseApp(pathname);
  const title = appDisplayName(brand, app);
  const icon = resolveBrandIconUrl(brand, app);
  const manifestApp =
    app === "survey" && pathname.startsWith("/estimator")
      ? "estimator"
      : app === "survey"
        ? "survey"
        : app;
  return {
    app,
    title,
    manifest: `/api/manifest/${manifestApp}`,
    icon,
    themeColor: brand.brandPrimaryColor || defaultBusinessBrandingSettings.brandPrimaryColor,
  };
}

export function PwaIconLinks() {
  const pathname = usePathname();
  const brandFromProvider = useBrand();
  const [brand, setBrand] = useState<PublicBranding>(brandFromProvider);

  useEffect(() => {
    setBrand(brandFromProvider);
  }, [brandFromProvider]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/branding", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { branding?: PublicBranding };
        if (!cancelled && body.branding) setBrand(toPublicBranding(body.branding));
      } catch {
        // Keep provider / defaults.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    const profile = buildProfile(pathname, brand);
    document.title = profile.title;

    upsertMeta("application-name", profile.title);
    upsertMeta("apple-mobile-web-app-title", profile.title);
    upsertMeta("apple-mobile-web-app-capable", "yes");
    upsertMeta("mobile-web-app-capable", "yes");
    upsertMeta("theme-color", profile.themeColor);

    // Tab favicon uses the full wordmark (not the droplet-only home mark).
    const tabFavicon = withVersion("/api/branding/favicon?size=32");
    const appleTouchHref = withVersion("/api/branding/favicon?size=180");

    document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]').forEach((link) => {
      link.href = appleTouchHref;
      link.sizes = "180x180";
      link.type = "image/png";
    });
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]').forEach((link) => {
      link.href = tabFavicon;
      link.sizes = "32x32";
      link.type = "image/png";
    });
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]').forEach((link) => {
      link.href = profile.manifest;
    });

    upsertLink("apple-touch-icon", appleTouchHref, { sizes: "180x180", type: "image/png" });
    upsertLink("icon", tabFavicon, { sizes: "32x32", type: "image/png" });
    upsertLink("manifest", profile.manifest);
  }, [brand, pathname]);

  return null;
}
