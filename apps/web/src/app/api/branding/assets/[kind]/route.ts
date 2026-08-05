import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { brandingAssetPublicPath, readBrandingAsset, saveBrandingAsset, type BrandingAssetKind } from "@/lib/branding-assets";
import { normalizeBusinessBranding } from "@/lib/branding";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ kind: string }> };

function asKind(value: string): BrandingAssetKind | null {
  if (value === "logo" || value === "icon") return value;
  return null;
}

/** Serve uploaded owner logo / home-screen icon (public for PWA install). */
export async function GET(request: Request, { params }: Params) {
  const kind = asKind((await params).kind);
  if (!kind) return NextResponse.json({ error: "Unknown asset." }, { status: 404 });

  const asset = readBrandingAsset(kind);
  if (!asset) {
    // Fall back to configured static path so home-screen install still works before upload.
    const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
    const fallback = kind === "icon" ? brand.appIconUrl || brand.logoUrl : brand.logoUrl;
    const safeFallback =
      !fallback || fallback.startsWith("/api/branding/assets/") ? "/ewg-logo.png" : fallback;
    return NextResponse.redirect(new URL(safeFallback, request.url), 302);
  }

  return new NextResponse(new Uint8Array(asset.buffer), {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** Upload owner logo or square app icon (Setup → Personalising). */
export async function POST(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.canCreateQuote && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kind = asKind((await params).kind);
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
  const patch =
    kind === "logo"
      ? { logoUrl: saved.url, ...(current.appIconUrl === current.logoUrl || !current.appIconUrl ? { appIconUrl: saved.url } : {}) }
      : { appIconUrl: saved.url };

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
