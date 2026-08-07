import { getBrandingFaviconPng } from "@/lib/branding-favicon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch / Safari icon — owner branding. */
export default async function AppleIcon() {
  const png = await getBrandingFaviconPng(180, "core");
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
    },
  });
}
