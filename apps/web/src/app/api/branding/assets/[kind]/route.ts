import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  asBrandingAssetKind,
  brandingAssetPublicPath,
  brandingAssetSettingsField,
  readBrandingAsset,
  saveBrandingAsset,
} from "@/lib/branding-assets";
import { normalizeBusinessBranding, resolveBrandIconUrl, type BrandAppKey } from "@/lib/branding";
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
    default:
      return undefined;
  }
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
        return new NextResponse(new Uint8Array(sharedLogo.buffer), {
          headers: {
            "Content-Type": sharedLogo.mimeType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
    }
    const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
    // Company "logo" asset must never fall through to the blake. product mark.
    // App icons (logo-field, etc.) may use the product mark when nothing was uploaded.
    const fallback =
      kind === "logo"
        ? brand.logoUrl || "/ewg-logo.png"
        : resolveBrandIconUrl(brand, appKeyForKind(kind));
    const safeFallback =
      !fallback || fallback.startsWith("/api/branding/assets/")
        ? kind === "logo"
          ? "/ewg-logo.png"
          : "/brand/blake-mark.svg"
        : fallback;
    return NextResponse.redirect(new URL(safeFallback, request.url), 302);
  }

  return new NextResponse(new Uint8Array(asset.buffer), {
    headers: {
      "Content-Type": asset.mimeType,
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
  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 4MB." }, { status: 413 });
  }
  if (file.type && !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Upload a PNG, JPG, WEBP or SVG image." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = saveBrandingAsset(kind, { name: file.name || `${kind}.png`, type: file.type || "image/png", buffer });

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
