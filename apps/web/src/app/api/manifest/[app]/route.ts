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
    description: "Guided site capture and survey packs.",
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
};

/** Dynamic PWA manifest using owner Personalising settings. */
export async function GET(_request: Request, { params }: Params) {
  const app = (await params).app;
  const config = appConfig[app];
  if (!config) {
    return NextResponse.json({ error: "Unknown app manifest." }, { status: 404 });
  }

  const brand = toPublicBranding(getHubDetailState().businessSettings);
  const name = appDisplayName(brand, config.key);
  const icon = resolveBrandIconUrl(brand);
  const theme = brand.brandPrimaryColor || "#157fa8";

  const manifest = {
    name,
    short_name: name.length > 12 ? config.shortFallback : name,
    description: `${brand.companyName} — ${config.description}`,
    start_url: config.startUrl,
    scope: config.scope,
    display: "standalone",
    background_color: theme,
    theme_color: theme,
    lang: "en-GB",
    icons: [
      {
        src: icon,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon,
        sizes: "any",
        type: "image/png",
        purpose: "any",
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
