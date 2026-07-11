"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const iconVersion = "20260711b";

const appProfiles = {
  core: {
    title: "NeXa Core",
    manifest: "/manifest-core.json",
    appleIcon: "/app-icons/nexa-core-apple-touch-icon.png",
    icon: "/app-icons/nexa-core-icon-512.png",
  },
  estimator: {
    title: "NeXa Estimator",
    manifest: "/manifest-estimator.json",
    appleIcon: "/app-icons/nexa-estimator-apple-touch-icon.png",
    icon: "/app-icons/nexa-estimator-icon-512.png",
  },
  takeoffs: {
    title: "NeXa Takeoffs",
    manifest: "/manifest-takeoffs.json",
    appleIcon: "/app-icons/nexa-takeoffs-apple-touch-icon.png",
    icon: "/app-icons/nexa-takeoffs-icon-512.png",
  },
};

function withVersion(path: string) {
  return `${path}?v=${iconVersion}`;
}

function upsertMeta(name: string, content: string) {
  const selector = `meta[name="${name}"]`;
  const meta = document.head.querySelector<HTMLMetaElement>(selector) ?? document.createElement("meta");
  meta.name = name;
  meta.content = content;
  if (!meta.parentElement) document.head.appendChild(meta);
}

function upsertLink(rel: string, href: string, options: { sizes?: string; type?: string } = {}) {
  const link = document.head.querySelector<HTMLLinkElement>(`link[data-nexa-pwa="${rel}"]`) ?? document.createElement("link");
  link.rel = rel;
  link.href = href;
  link.dataset.nexaPwa = rel;
  if (options.sizes) link.sizes = options.sizes;
  if (options.type) link.type = options.type;
  if (!link.parentElement) document.head.appendChild(link);
}

function chooseProfile(pathname: string) {
  if (pathname.startsWith("/takeoff")) return appProfiles.takeoffs;
  if (pathname.startsWith("/estimator") || pathname.startsWith("/survey")) return appProfiles.estimator;
  return appProfiles.core;
}

export function PwaIconLinks() {
  const pathname = usePathname();

  useEffect(() => {
    const profile = chooseProfile(pathname);
    document.title = profile.title;

    upsertMeta("application-name", profile.title);
    upsertMeta("apple-mobile-web-app-title", profile.title);
    upsertMeta("apple-mobile-web-app-capable", "yes");
    upsertMeta("mobile-web-app-capable", "yes");
    upsertMeta("theme-color", "#006eb8");

    const appleIconHref = withVersion(profile.appleIcon);
    const appIconHref = withVersion(profile.icon);

    document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]').forEach((link) => {
      link.href = appleIconHref;
      link.sizes = "180x180";
      link.type = "image/png";
    });
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => {
      link.href = appIconHref;
      link.sizes = "512x512";
      link.type = "image/png";
    });
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]').forEach((link) => {
      link.href = profile.manifest;
    });

    upsertLink("apple-touch-icon", appleIconHref, { sizes: "180x180", type: "image/png" });
    upsertLink("icon", appIconHref, { sizes: "512x512", type: "image/png" });
    upsertLink("manifest", profile.manifest);
  }, [pathname]);

  return null;
}
