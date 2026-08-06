import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { normalizeBusinessBranding, type BrandAppKey } from "@/lib/branding";
import { readBrandingAsset, type BrandingAssetKind } from "@/lib/branding-assets";
import { ensureSquareAppIcon } from "@/lib/branding-icon-square";
import { getHubDetailState } from "@/lib/hub-detail-store";

function kindForApp(app?: BrandAppKey): BrandingAssetKind {
  switch (app) {
    case "field":
      return "logo-field";
    case "survey":
    case "estimator":
      return "logo-survey";
    case "takeoffs":
      return "logo-takeoffs";
    case "heat-design":
      return "logo-heat-design";
    case "trainer":
      return "logo-trainer";
    case "core":
    default:
      return "logo-core";
  }
}

function readFallbackPng(): Buffer | null {
  const candidates = [
    path.join(process.cwd(), "public", "ewg-mark.png"),
    path.join(process.cwd(), "public", "app-icons", "ewg-icon-512.png"),
    path.join(process.cwd(), "public", "ewg-logo.png"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      return readFileSync(file);
    } catch {
      // try next
    }
  }
  return null;
}

/** Build a square PNG favicon / tab icon from owner Personalising branding. */
export async function getBrandingFaviconPng(size: number, app?: BrandAppKey): Promise<Buffer> {
  const kind = kindForApp(app);
  const fallback = readFallbackPng();
  const asset =
    readBrandingAsset(kind) ||
    readBrandingAsset("icon") ||
    readBrandingAsset("logo") ||
    (fallback ? { buffer: fallback, mimeType: "image/png" } : null);

  if (!asset) {
    // Solid brand tile if nothing is uploaded yet.
    const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
    const hex = (brand.brandPrimaryColor || "#38A1CE").replace("#", "");
    const r = Number.parseInt(hex.slice(0, 2), 16) || 56;
    const g = Number.parseInt(hex.slice(2, 4), 16) || 161;
    const b = Number.parseInt(hex.slice(4, 6), 16) || 206;
    return sharp({
      create: { width: size, height: size, channels: 3, background: { r, g, b } },
    })
      .png()
      .toBuffer();
  }

  const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
  const squared = await ensureSquareAppIcon(asset.buffer, {
    background: brand.brandPrimaryColor || "#38A1CE",
  });
  return sharp(squared.buffer, { failOn: "none" }).resize(size, size, { fit: "fill" }).png().toBuffer();
}
