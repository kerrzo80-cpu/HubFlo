import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { normalizeBusinessBranding, type BrandAppKey } from "@/lib/branding";
import { readBrandingAsset, type BrandingAssetKind } from "@/lib/branding-assets";
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
  const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
  const name = `${brand.companyName} ${brand.tradingName} ${brand.productName}`;
  if (!/errol watson/i.test(name) && !/\bEWG\b/.test(brand.productName)) return null;
  const candidates = [
    path.join(process.cwd(), "public", "ewg-logo.png"),
    path.join(process.cwd(), "public", "ewg-mark.png"),
    path.join(process.cwd(), "public", "app-icons", "ewg-icon-512.png"),
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

/**
 * Browser-tab favicon from the full owner logo (wordmark), not the droplet-only
 * home-screen mark — that mark is too easy to confuse with the old NeXa icon.
 */
export async function getBrandingFaviconPng(size: number, app?: BrandAppKey): Promise<Buffer> {
  const kind = kindForApp(app);
  const fallback = readFallbackPng();
  const asset =
    readBrandingAsset(kind) ||
    readBrandingAsset("logo") ||
    readBrandingAsset("icon") ||
    (fallback ? { buffer: fallback, mimeType: "image/png" } : null);

  if (!asset) {
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

  let trimmed: Buffer;
  try {
    trimmed = await sharp(asset.buffer, { failOn: "none" }).rotate().trim({ threshold: 18 }).png().toBuffer();
  } catch {
    trimmed = await sharp(asset.buffer, { failOn: "none" }).rotate().png().toBuffer();
  }

  const fitBox = Math.max(8, Math.round(size * 0.9));
  const fitted = await sharp(trimmed, { failOn: "none" })
    .resize(fitBox, fitBox, {
      fit: "inside",
      withoutEnlargement: false,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.max(0, Math.floor((size - (fitted.info.width || fitBox)) / 2));
  const top = Math.max(0, Math.floor((size - (fitted.info.height || fitBox)) / 2));

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: fitted.data, left, top }])
    .png()
    .toBuffer();
}
