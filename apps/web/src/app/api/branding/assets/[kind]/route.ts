import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  asBrandingAssetKind,
  brandingAssetPublicPath,
  brandingAssetSettingsField,
  readBrandingAsset,
  saveBrandingAsset,
  type BrandingAssetKind,
} from "@/lib/branding-assets";
import { ensureSquareAppIcon, isAppIconAssetKind } from "@/lib/branding-icon-square";
import { normalizeBusinessBranding, resolveBrandIconUrl, resolveBrandLogoUrl, type BrandAppKey } from "@/lib/branding";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ kind: string }> };

function appKeyForKind(kind: string): BrandAppKey | undefined {
  switch (kind) {
    case "logo-core":
      return "core";
    case "logo-field":
      return "field";
    case "logo-survey":
      return "survey";
    case "logo-takeoffs":
      return "takeoffs";
    case "logo-heat-design":
      return "heat-design";
    case "logo-trainer":
      return "trainer";
    default:
      return undefined;
  }
}

async function squareAndPersistIfNeeded(kind: BrandingAssetKind, asset: { buffer: Buffer; mimeType: string }) {
  if (!isAppIconAssetKind(kind)) return asset;
  const squared = await ensureSquareAppIcon(asset.buffer);
  if (!squared.changed) {
    return { buffer: squared.buffer, mimeType: squared.mimeType };
  }

  const saved = saveBrandingAsset(kind, {
    name: `${kind}.png`,
    type: "image/png",
    buffer: squared.buffer,
  });

  // Bust caches on home-screen icons after auto-repair.
  const hub = getHubDetailState();
  const current = normalizeBusinessBranding(hub.businessSettings);
  const field = brandingAssetSettingsField(kind);
  saveHubDetailState({
    ...hub,
    businessSettings: { ...current, [field]: saved.url },
  });

  return { buffer: squared.buffer, mimeType: squared.mimeType };
}

/** Serve uploaded owner logo / home-screen icon (public for PWA install). */
export async function GET(request: Request, { params }: Params) {
  const kind = asBrandingAssetKind((await params).kind);
  if (!kind) return NextResponse.json({ error: "Unknown asset." }, { status: 404 });

  const asset = readBrandingAsset(kind);
  if (!asset) {
    // Chain: per-app → shared icon → company logo → static default.
    if (kind.startsWith("logo-")) {
      return NextResponse.redirect(new URL("/api/branding/assets/icon", request.url), 302);
    }
    if (kind === "icon") {
      const sharedLogo = readBrandingAsset("logo");
      if (sharedLogo) {
        const squared = await squareAndPersistIfNeeded("icon", sharedLogo).catch(() => sharedLogo);
        return new NextResponse(new Uint8Array(squared.buffer), {
          headers: {
            "Content-Type": squared.mimeType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
    }
    const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
    const fallback =
      kind === "logo" ? resolveBrandLogoUrl(brand) : resolveBrandIconUrl(brand, appKeyForKind(kind));
    const safeFallback =
      !fallback || fallback.startsWith("/api/branding/assets/") ? "/ewg-logo.png" : fallback;
    return NextResponse.redirect(new URL(safeFallback, request.url), 302);
  }

  const served = await squareAndPersistIfNeeded(kind, asset).catch(() => asset);
  return new NextResponse(new Uint8Array(served.buffer), {
    headers: {
      "Content-Type": served.mimeType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** Upload owner logo, shared app icon, or per-app logo (Setup → Personalising). */
export async function POST(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.canCreateQuote && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kind = asBrandingAssetKind((await params).kind);
  if (!kind) return NextResponse.json({ error: "Unknown asset." }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 8MB before prepare." }, { status: 413 });
  }
  if (file.type && !file.type.startsWith("image/") && file.type !== "application/octet-stream") {
    return NextResponse.json({ error: "Upload a PNG, JPG, WEBP or SVG image." }, { status: 400 });
  }

  let buffer = Buffer.from(await file.arrayBuffer());
  let mimeType = file.type || "image/png";
  let fileName = file.name || `${kind}.png`;

  if (isAppIconAssetKind(kind)) {
    const squared = await ensureSquareAppIcon(buffer);
    buffer = Buffer.from(squared.buffer);
    mimeType = squared.mimeType;
    fileName = `${kind}.png`;
  }

  const saved = saveBrandingAsset(kind, { name: fileName, type: mimeType, buffer });

  const hub = getHubDetailState();
  const current = normalizeBusinessBranding(hub.businessSettings);
  const field = brandingAssetSettingsField(kind);
  const patch: Record<string, string> = { [field]: saved.url };

  if (kind === "logo" && (current.appIconUrl === current.logoUrl || !current.appIconUrl)) {
    patch.appIconUrl = saved.url;
  }

  saveHubDetailState({
    ...hub,
    businessSettings: { ...current, ...patch },
  });

  return NextResponse.json({
    ok: true,
    kind,
    url: saved.url,
    publicPath: brandingAssetPublicPath(kind),
    businessSettings: normalizeBusinessBranding({ ...current, ...patch }),
  });
}
