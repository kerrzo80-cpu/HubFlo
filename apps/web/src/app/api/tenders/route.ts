import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  deleteTender,
  deleteTenders,
  archiveTenders,
  convertTenderToPendingJob,
  importBoqIntoTender,
  listTenders,
  markTenderSubmitted,
  updateBoqLine,
  updateTender,
  upsertTender,
  type Tender,
  type TenderBoqLine,
  type TenderStatus,
} from "@/lib/tenders-data";

export const runtime = "nodejs";

function canView(access: ReturnType<typeof getAccessProfileFromHeaders>) {
  return access.showQuotes || access.showJobs || access.showFinance;
}

function canEdit(access: ReturnType<typeof getAccessProfileFromHeaders>) {
  return access.canCreateQuote || access.canEditJobs || access.showFinance || access.canCustomize;
}

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canView(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ tenders: listTenders() });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canEdit(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{
    action?:
      | "upsert"
      | "update"
      | "delete"
      | "delete-bulk"
      | "archive-bulk"
      | "import-boq"
      | "update-boq-line"
      | "submit"
      | "convert-won";
    id?: string;
    ids?: string[];
    tender?: Partial<Tender> & { name?: string; client?: string };
    patch?: Partial<Tender>;
    lineId?: string;
    linePatch?: Partial<TenderBoqLine>;
    boqText?: string;
    boqTitle?: string;
    tenderSum?: number;
    status?: TenderStatus;
  }>(request);

  try {
    if (body?.action === "upsert") {
      if (!body.tender?.name || !body.tender?.client) {
        return NextResponse.json({ error: "name and client required" }, { status: 400 });
      }
      const tender = upsertTender({
        ...body.tender,
        name: body.tender.name,
        client: body.tender.client,
      });
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "update") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const tender = updateTender(body.id, body.patch || {});
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "delete") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      deleteTender(body.id);
      return NextResponse.json({ ok: true, tenders: listTenders() });
    }

    if (body?.action === "delete-bulk") {
      if (!body.ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
      const result = deleteTenders(body.ids);
      return NextResponse.json({ ok: true, ...result });
    }

    if (body?.action === "archive-bulk") {
      if (!body.ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
      const result = archiveTenders(body.ids);
      return NextResponse.json({ ok: true, ...result });
    }

    if (body?.action === "import-boq") {
      if (!body.id || !body.boqText) {
        return NextResponse.json({ error: "id and boqText required" }, { status: 400 });
      }
      const tender = importBoqIntoTender(body.id, body.boqText, body.boqTitle);
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "update-boq-line") {
      if (!body.id || !body.lineId) {
        return NextResponse.json({ error: "id and lineId required" }, { status: 400 });
      }
      const tender = updateBoqLine(body.id, body.lineId, body.linePatch || {});
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "submit") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const tender = markTenderSubmitted(body.id, { tenderSum: body.tenderSum });
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "convert-won") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const result = convertTenderToPendingJob(body.id);
      return NextResponse.json({ ...result, tenders: listTenders() });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update tender" },
      { status: 400 },
    );
  }
}
