import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  archivePrebuild,
  importKitsFromXlsx,
  listPrebuilds,
  upsertPrebuild,
  type PrebuildLineKind,
} from "@/lib/prebuild-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote && !access.canEditJobs && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
  return NextResponse.json({ kits: listPrebuilds(includeArchived) });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const action = String(form.get("action") || "import-xlsx");
      if (action !== "import-xlsx") {
        return NextResponse.json({ error: "Unknown kit import action." }, { status: 400 });
      }
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "Upload an Excel .xlsx kits file." }, { status: 400 });
      }
      const modeRaw = String(form.get("mode") || "merge");
      const mode = modeRaw === "replace" ? "replace" : "merge";
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = importKitsFromXlsx(buffer, {
        mode,
        fileName: typeof file.name === "string" ? file.name : "kits.xlsx",
      });
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to import kits." },
        { status: 400 },
      );
    }
  }

  const body = await parseJsonRequestBody<{
    action?: "upsert" | "archive" | "import-xlsx";
    id?: string;
    name?: string;
    category?: string;
    notes?: string;
    mode?: "merge" | "replace";
    fileBase64?: string;
    fileName?: string;
    lines?: Array<{
      id?: string;
      kind: PrebuildLineKind;
      description: string;
      quantity?: number;
      unitCost?: number;
      unitSell?: number;
      unit?: string;
    }>;
  }>(request);

  try {
    if (body?.action === "archive" && body.id) {
      return NextResponse.json({ kits: archivePrebuild(body.id).kits.filter((kit) => !kit.archived) });
    }
    if (body?.action === "import-xlsx" && body.fileBase64) {
      const buffer = Buffer.from(body.fileBase64, "base64");
      const result = importKitsFromXlsx(buffer, {
        mode: body.mode === "replace" ? "replace" : "merge",
        fileName: body.fileName || "kits.xlsx",
      });
      return NextResponse.json(result);
    }
    if (body?.action === "upsert" && body.name) {
      const store = upsertPrebuild({
        id: body.id,
        name: body.name,
        category: body.category,
        notes: body.notes,
        lines: body.lines,
      });
      return NextResponse.json({ kits: store.kits.filter((kit) => !kit.archived) });
    }
    return NextResponse.json({ error: "Unknown kit action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update kits." },
      { status: 400 },
    );
  }
}
