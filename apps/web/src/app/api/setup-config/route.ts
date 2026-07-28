import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  archiveSetupListItem,
  getSetupConfig,
  upsertSetupListItem,
  type SetupAssetType,
  type SetupEmailTemplate,
  type SetupLostReason,
  type SetupSecurityGroup,
  type SetupStatusOption,
  type SetupTaxCode,
} from "@/lib/setup-config-data";

export const runtime = "nodejs";

type ListKey = "statuses" | "lostReasons" | "taxCodes" | "emailTemplates" | "assetTypes" | "securityGroups";

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(getSetupConfig());
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{
    action?: "upsert" | "archive";
    list?: ListKey;
    id?: string;
    item?: SetupStatusOption | SetupLostReason | SetupTaxCode | SetupEmailTemplate | SetupAssetType | SetupSecurityGroup;
  }>(request);

  try {
    if (!body?.list) return NextResponse.json({ error: "list is required" }, { status: 400 });
    if (body.action === "archive" && body.id) {
      return NextResponse.json(archiveSetupListItem(body.list, body.id));
    }
    if (body.action === "upsert" && body.item) {
      return NextResponse.json(upsertSetupListItem(body.list, body.item));
    }
    return NextResponse.json({ error: "Unknown setup-config action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update setup config" },
      { status: 400 },
    );
  }
}
