import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  asBrandingAssetKind,
  brandingAssetPublicPath,
  brandingAssetSettingsField,
  readBrandingAsset,
  readBrandingAssetMeta,
  readHomeIconAsset,
  saveBrandingAsset,
  saveHomeIconAsset,
  type BrandingAssetKind,
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
    case "logo-trainer":
      return "trainer";
    default:
      return undefined;
  }
}

/** Prefer public app URL — Render's request URL can be 0.0.0.0:10000. */
function publicOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

async function buildHomeIcon(kind: BrandingAssetKind, source: { buffer: Buffer; mimeType: string }) {
  const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
  const squared = await ensureSquareAppIcon(source.buffer, {
    background: brand.brandPrimaryColor || "#157fa8",
  });

  // Shared "icon" asset is home-screen-only — persist compose as the main file.
  if (kind === "icon") {
    saveBrandingAsset(
      kind,
      { name: `${kind}.png`, type: "image/png", buffer: squared.buffer },
      { composeVersion: squared.composeVersion },
    );
    const hub = getHubDetailState();
    const current = normalizeBusinessBranding(hub.businessSettings);
    saveHubDetailState({
      ...hub,
      businessSettings: { ...current, appIconUrl: `${brandingAssetPublicPath("icon")}?v=${Date.now()}` },
    });
  } else {
    // Per-app logos keep the wide source for headers; home icon is a side cache.
    saveHomeIconAsset(kind, squared.buffer, squared.composeVersion);
  }

  return { buffer: squared.buffer, mimeType: squared.mimeType };
}

async function serveHomeIcon(kind: BrandingAssetKind, source: { buffer: Buffer; mimeType: string }, apple: boolean) {
  let home =
    kind === "icon"
      ? null
      : readHomeIconAsset(kind, APP_ICON_COMPOSE_VERSION);

  // Shared icon: reuse main file when already on current compose version.
  if (kind === "icon") {
    const metaCompose = readBrandingAssetMeta(kind)?.composeVersion;
    if (metaCompose === APP_ICON_COMPOSE_VERSION) {
      home = source;
    }
  }

  if (!home) {
    home = await buildHomeIcon(kind, source);
  }

  const body = apple ? await toAppleTouchIcon(home.buffer) : home.buffer;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
    },
  });
}

/** Serve uploaded owner logo / home-screen icon (public for PWA install). */
export async function GET(request: Request, { params }: Params) {
  const kind = asBrandingAssetKind((await params).kind);
  if (!kind) return NextResponse.json({ error: "Unknown asset." }, { status: 404 });

  const url = new URL(request.url);
  const apple = url.searchParams.get("apple") === "1";
  const home = apple || url.searchParams.get("home") === "1";
  const asset = readBrandingAsset(kind);

  if (!asset) {
    if (kind.startsWith("logo-")) {
      return NextResponse.redirect(new URL(`/api/branding/assets/icon${home ? "?home=1" : ""}`, publicOrigin(request)), 302);
    }
    if (kind === "icon") {
      const sharedLogo = readBrandingAsset("logo");
      if (sharedLogo) {
        try {
          return await serveHomeIcon("icon", sharedLogo, apple);
        } catch {
          return new NextResponse(null, { status: 404 });
        }
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
      "Cache-Control": "public, max-age=300",
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
  let composeVersion: number | undefined;

  // Shared home-screen icon is composed into the stored file.
  // Per-app logos keep the uploaded artwork for headers; home icons are built on demand.
  if (kind === "icon") {
    const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
    const squared = await ensureSquareAppIcon(buffer, {
      background: brand.brandPrimaryColor || "#157fa8",
    });
    buffer = Buffer.from(squared.buffer);
    mimeType = squared.mimeType;
    fileName = `${kind}.png`;
    composeVersion = squared.composeVersion;
  }

  const saved = saveBrandingAsset(
    kind,
    { name: fileName, type: mimeType, buffer },
    composeVersion ? { composeVersion } : undefined,
  );

  // Eagerly warm the home-screen derivative for per-app logos.
  if (kind.startsWith("logo-")) {
    try {
      await buildHomeIcon(kind, { buffer, mimeType });
    } catch {
      // On-demand compose will retry on first home-icon request.
    }
  }

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
