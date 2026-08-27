import { NextResponse } from "next/server";

import { appDisplayName, resolveBrandIconUrl, toPublicBranding, type BrandAppKey } from "@/lib/branding";
import { getHubDetailState } from "@/lib/hub-detail-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ app: string }> };

const appConfig: Record<
  string,
  { key: BrandAppKey; startUrl: string; scope: string; shortFallback: string; description: string }
> = {
  core: {
    key: "core",
    startUrl: "/",
    scope: "/",
    shortFallback: "Core",
    description: "Command center for leads, quotes, jobs, invoices and operations.",
  },
  ayla: {
    // Reuse the company's main app icon until Ayla gets a dedicated icon field in Personalising.
    key: "core",
    startUrl: "/blake",
    scope: "/blake",
    shortFallback: "Ask Ayla",
    description: "Conversational AI office manager connected to the authorised Blake workspace.",
  },
  field: {
    key: "field",
    startUrl: "/field",
    scope: "/field",
    shortFallback: "Field",
    description: "Schedule, job packs and hours for field engineers.",
  },
  survey: {
    key: "survey",
    startUrl: "/survey",
    scope: "/survey",
    shortFallback: "Survey",
    description: "Site capture, evidence packs and Blake cost centres.",
  },
  estimator: {
    key: "estimator",
    startUrl: "/estimator",
    scope: "/estimator",
    shortFallback: "Estimator",
    description: "Survey to priced work package.",
  },
  takeoffs: {
    key: "takeoffs",
    startUrl: "/takeoff",
    scope: "/takeoff",
    shortFallback: "Takeoffs",
    description: "Drawing mark-up and quantity takeoffs.",
  },
  "heat-design": {
    key: "heat-design",
    startUrl: "/heat-design",
    scope: "/heat-design",
    shortFallback: "Heat Design",
    description: "Floor plan, emitters and heat kit linked to quotes and jobs.",
  },
  trainer: {
    key: "trainer",
    startUrl: "/train",
    scope: "/train",
    shortFallback: "Trainer",
    description: "Voice-first staff trainer with role-aware modules and checks.",
  },
};

/** Dynamic PWA manifest using owner Personalising settings. */
export async function GET(_request: Request, { params }: Params) {
  const app = (await params).app;
  const config = appConfig[app];
  if (!config) {
    return NextResponse.json({ error: "Unknown app manifest." }, { status: 404 });
  }

  const brand = toPublicBranding(getHubDetailState().businessSettings);
  const configuredName = appDisplayName(brand, config.key);
  const name = app === "ayla" ? "Ask Ayla" : configuredName;
  const icon = resolveBrandIconUrl(brand, config.key);
  const theme = brand.brandPrimaryColor || "#157fa8";

  const manifest = {
    name,
    short_name: app === "ayla" ? "Ask Ayla" : name.length > 12 ? config.shortFallback : name,
    description: `${brand.companyName} — ${config.description}`,
    start_url: config.startUrl,
    scope: config.scope,
    display: "standalone",
    background_color: theme,
    theme_color: theme,
    lang: "en-GB",
    icons: [
      {
        src: icon.includes("?") ? `${icon}&v=compose5` : `${icon}?v=compose5`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon.includes("?") ? `${icon}&v=compose5` : `${icon}?v=compose5`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon.includes("?") ? `${icon}&v=compose5` : `${icon}?v=compose5`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
