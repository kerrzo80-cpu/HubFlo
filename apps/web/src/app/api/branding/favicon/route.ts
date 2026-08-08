import { NextResponse } from "next/server";

import { getBrandingFaviconPng } from "@/lib/branding-favicon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Small PNG favicon for browser tabs (Safari-friendly; no redirect). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sizeParam = Number(url.searchParams.get("size") || "32");
  const size = Number.isFinite(sizeParam) ? Math.min(256, Math.max(16, Math.round(sizeParam))) : 32;

  try {
    const png = await getBrandingFaviconPng(size, "core");
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.redirect(new URL("/ewg-mark.png", request.url), 302);
  }
}
