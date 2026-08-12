import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  addBoqMeasuredLine,
  addBoqSheetTab,
  addTenderDocumentFolder,
  clearBoqFromTender,
  deleteBoqLines,
  deleteBoqSheetTab,
  deleteTender,
  deleteTenders,
  archiveTenders,
  convertTenderToPendingJob,
  importBoqIntoTender,
  listTenders,
  markTenderSubmitted,
  moveTenderDocument,
  removeTenderDocument,
  removeTenderDocumentFolder,
  renameBoqSheetTab,
  updateBoqLine,
  updateTender,
  upsertTender,
  type Tender,
  type TenderBoqLine,
  type TenderDocumentKind,
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
      | "clear-boq"
      | "update-boq-line"
      | "add-boq-line"
      | "delete-boq-lines"
      | "add-boq-sheet"
      | "rename-boq-sheet"
      | "delete-boq-sheet"
      | "delete-document"
      | "create-document-folder"
      | "delete-document-folder"
      | "move-document"
      | "submit"
      | "convert-won";
    id?: string;
    ids?: string[];
    documentId?: string;
    folderId?: string | null;
    folderName?: string;
    parentId?: string | null;
    kind?: TenderDocumentKind;
    tender?: Partial<Tender> & { name?: string; client?: string };
    patch?: Partial<Tender>;
    lineId?: string;
    lineIds?: string[];
    linePatch?: Partial<TenderBoqLine>;
    boqText?: string;
    boqTitle?: string;
    mode?: "replace" | "append" | "add";
    boqImportMode?: "replace" | "append" | "add";
    appendSheetLabel?: string;
    sheetKey?: string;
    sheetName?: string;
    line?: Partial<TenderBoqLine>;
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
      const modeRaw = String(body.boqImportMode || body.mode || "replace").trim().toLowerCase();
      const mode = modeRaw === "append" || modeRaw === "add" ? "append" : "replace";
      const tender = importBoqIntoTender(body.id, body.boqText, body.boqTitle, {
        mode,
        appendSheetLabel: body.appendSheetLabel,
      });
      return NextResponse.json({ tender, tenders: listTenders(), mode });
    }

    if (body?.action === "clear-boq") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const tender = clearBoqFromTender(body.id);
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "update-boq-line") {
      if (!body.id || !body.lineId) {
        return NextResponse.json({ error: "id and lineId required" }, { status: 400 });
      }
      const tender = updateBoqLine(body.id, body.lineId, body.linePatch || {});
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "add-boq-line") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const tender = addBoqMeasuredLine(body.id, {
        sheet: body.sheetKey ?? body.line?.sheet,
        ref: body.line?.ref,
        description: body.line?.description,
        quantity: body.line?.quantity,
        unit: body.line?.unit,
      });
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "delete-boq-lines") {
      if (!body.id || !body.lineIds?.length) {
        return NextResponse.json({ error: "id and lineIds required" }, { status: 400 });
      }
      const tender = deleteBoqLines(body.id, body.lineIds);
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "add-boq-sheet") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const result = addBoqSheetTab(body.id, body.sheetName);
      return NextResponse.json({
        tender: result.tender,
        tenders: listTenders(),
        sheetKey: result.sheetKey,
      });
    }

    if (body?.action === "rename-boq-sheet") {
      if (!body.id || !body.sheetKey) {
        return NextResponse.json({ error: "id and sheetKey required" }, { status: 400 });
      }
      const result = renameBoqSheetTab(body.id, body.sheetKey, body.sheetName || "");
      return NextResponse.json({
        tender: result.tender,
        tenders: listTenders(),
        sheetKey: result.sheetKey,
      });
    }

    if (body?.action === "delete-boq-sheet") {
      if (!body.id || !body.sheetKey) {
        return NextResponse.json({ error: "id and sheetKey required" }, { status: 400 });
      }
      const tender = deleteBoqSheetTab(body.id, body.sheetKey);
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "delete-document") {
      if (!body.id || !body.documentId) {
        return NextResponse.json({ error: "id and documentId required" }, { status: 400 });
      }
      const tender = removeTenderDocument(body.id, body.documentId);
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "create-document-folder") {
      if (!body.id || !body.folderName?.trim()) {
        return NextResponse.json({ error: "id and folderName required" }, { status: 400 });
      }
      const tender = addTenderDocumentFolder(body.id, {
        name: body.folderName,
        parentId: body.parentId,
      });
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "delete-document-folder") {
      if (!body.id || !body.folderId) {
        return NextResponse.json({ error: "id and folderId required" }, { status: 400 });
      }
      const tender = removeTenderDocumentFolder(body.id, body.folderId);
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (body?.action === "move-document") {
      if (!body.id || !body.documentId) {
        return NextResponse.json({ error: "id and documentId required" }, { status: 400 });
      }
      const tender = moveTenderDocument(body.id, body.documentId, {
        kind: body.kind,
        folderId: body.folderId,
      });
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
