import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  archiveSiteAsset,
  dueSiteAssets,
  listSiteAssets,
  upsertSiteAsset,
  type SiteAssetType,
} from "@/lib/site-assets-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showAssets && !access.showCustomers && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const siteId = request.nextUrl.searchParams.get("siteId") || undefined;
  const clientId = request.nextUrl.searchParams.get("clientId") || undefined;
  const due = request.nextUrl.searchParams.get("due");
  const withinDays = Number(request.nextUrl.searchParams.get("withinDays") || "0");
  if (due === "1" || due === "true") {
    return NextResponse.json({
      assets: dueSiteAssets(undefined, Number.isFinite(withinDays) ? withinDays : 0),
    });
  }
  return NextResponse.json({ assets: listSiteAssets({ siteId, clientId }) });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showAssets && !access.showCustomers && !access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{
    action?: "upsert" | "archive";
    id?: string;
    siteId?: string;
    clientId?: string;
    type?: SiteAssetType;
    name?: string;
    make?: string;
    model?: string;
    serialNumber?: string;
    locationNote?: string;
    installDate?: string;
    lastServiceDate?: string;
    nextServiceDate?: string;
    warrantyUntil?: string;
    certificateNumber?: string;
    certificateIssuedAt?: string;
    certificateExpiresAt?: string;
    notes?: string;
  }>(request);

  try {
    if (body?.action === "archive" && body.id) {
      return NextResponse.json({ assets: archiveSiteAsset(body.id) });
    }
    if (!body?.siteId || !body.name || !body.type) {
      return NextResponse.json({ error: "siteId, name and type are required." }, { status: 400 });
    }
    const assets = upsertSiteAsset({
      id: body.id,
      siteId: body.siteId,
      clientId: body.clientId,
      type: body.type,
      name: body.name,
      make: body.make,
      model: body.model,
      serialNumber: body.serialNumber,
      locationNote: body.locationNote,
      installDate: body.installDate,
      lastServiceDate: body.lastServiceDate,
      nextServiceDate: body.nextServiceDate,
      warrantyUntil: body.warrantyUntil,
      certificateNumber: body.certificateNumber,
      certificateIssuedAt: body.certificateIssuedAt,
      certificateExpiresAt: body.certificateExpiresAt,
      notes: body.notes,
    });
    return NextResponse.json({ assets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save asset." },
      { status: 400 },
    );
  }
}
