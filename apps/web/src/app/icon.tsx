import { getBrandingFaviconPng } from "@/lib/branding-favicon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Browser tab favicon — owner EWG / Personalising mark, not the NeXa product icon. */
export default async function Icon() {
  const png = await getBrandingFaviconPng(32, "core");
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
    },
  });
}
