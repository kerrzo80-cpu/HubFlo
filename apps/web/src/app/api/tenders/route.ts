import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { parseJsonRequestBody } from "@/lib/http";
import { assertRecordLockForWrite } from "@/lib/record-edit-locks";
import { recordLockErrorResponse } from "@/lib/record-lock-http";
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
  rebuildTenderJobCostCentres,
  rebuildJobCostCentresFromSourceTender,
  healJobCostCentresForJob,
  syncTenderDocumentsToLinkedJob,
  syncJobDocumentsFromSourceTender,
  importBoqIntoTender,
  leanTenderForClient,
  listTendersLean,
  getTender,
  markTenderSubmitted,
  mergeBoqLinesIntoSheet,
  moveBoqLinesToSection,
  moveBoqLinesToSheet,
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

const TENDER_LOCK_ACTIONS = new Set([
  "update",
  "delete",
  "import-boq",
  "clear-boq",
  "update-boq-line",
  "add-boq-line",
  "delete-boq-lines",
  "add-boq-sheet",
  "rename-boq-sheet",
  "delete-boq-sheet",
  "move-boq-lines",
  "move-boq-lines-to-section",
  "merge-boq-lines",
  "delete-document",
  "create-document-folder",
  "delete-document-folder",
  "move-document",
  "submit",
  "convert-won",
  "rebuild-job-cost-centres",
  "sync-job-documents",
]);

function assertTenderWriteLock(action: string | undefined, tenderId: string | undefined, userId: string) {
  if (!action || !tenderId || !TENDER_LOCK_ACTIONS.has(action)) return;
  assertRecordLockForWrite({ recordType: "tender", recordId: tenderId, userId });
}

/** Always strip BoQ dumps from list payloads — full Bills OOMed Render. */
function leanList() {
  return listTendersLean();
}

function leanOne(tender: Tender) {
  return leanTenderForClient(tender);
}

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canView(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (id) {
    const tender = getTender(id);
    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    // Single tender may include BoQ for the open editor.
    return NextResponse.json({ tender });
  }
  // Tracker list must never include BoQ line arrays.
  return NextResponse.json({ tenders: leanList() });
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canEdit(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{
    action?:
      | "get"
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
      | "move-boq-lines"
      | "move-boq-lines-to-section"
      | "merge-boq-lines"
      | "delete-document"
      | "create-document-folder"
      | "delete-document-folder"
      | "move-document"
      | "submit"
      | "convert-won"
      | "rebuild-job-cost-centres"
      | "sync-job-documents"
      | "sync-job-documents-from-job"
      | "heal-job-cost-centres"
      | "rebuild-job-cost-centres-from-job";
    id?: string;
    jobId?: string;
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
    sourceSheet?: string;
    targetSectionId?: string;
    newSectionName?: string;
    mergeWholeSource?: boolean;
    line?: Partial<TenderBoqLine>;
    tenderSum?: number;
    status?: TenderStatus;
  }>(request);

  try {
    const authUser = getAuthenticatedUser(request);
    if (authUser) {
      assertTenderWriteLock(body?.action, body?.id, authUser.id);
    }

    if (body?.action === "get") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const tender = getTender(body.id);
      if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
      return NextResponse.json({ tender });
    }

    if (body?.action === "upsert") {
      if (!body.tender?.name || !body.tender?.client) {
        return NextResponse.json({ error: "name and client required" }, { status: 400 });
      }
      const tender = upsertTender({
        ...body.tender,
        name: body.tender.name,
        client: body.tender.client,
      });
      return NextResponse.json({ tender, tenders: leanList() });
    }

    if (body?.action === "update") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const tender = updateTender(body.id, body.patch || {});
      return NextResponse.json({ tender: leanOne(tender), tenders: leanList() });
    }

    if (body?.action === "delete") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      deleteTender(body.id);
      return NextResponse.json({ ok: true, tenders: leanList() });
    }

    if (body?.action === "delete-bulk") {
      if (!body.ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
      const result = deleteTenders(body.ids);
      return NextResponse.json({
        ok: true,
        ...result,
        tenders: Array.isArray(result.tenders) ? leanList() : leanList(),
      });
    }

    if (body?.action === "archive-bulk") {
      if (!body.ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
      const result = archiveTenders(body.ids);
      return NextResponse.json({
        ok: true,
        ...result,
        tenders: leanList(),
      });
    }

    if (body?.action === "import-boq") {
      if (!body.id || !body.boqText) {
        return NextResponse.json({ error: "id and boqText required" }, { status: 400 });
      }
      const modeRaw = String(body.boqImportMode || body.mode || "replace").trim().toLowerCase();
      const mode = modeRaw === "append" || modeRaw === "add" ? "append" : "replace";
      const tender = importBoqIntoTender(body.id, body.boqText, body.boqTitle, {
        mode,
        appendSheetLabel: body.appendSheetLabel || "Additional items",
      });
      const addedSheets = Array.isArray((tender as { addedSheets?: string[] }).addedSheets)
        ? (tender as { addedSheets: string[] }).addedSheets
        : [];
      // Return this tender's BoQ (editor needs it) but never dump every tender's Bill.
      return NextResponse.json({ tender, tenders: leanList(), mode, addedSheets });
    }

    if (body?.action === "clear-boq") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const tender = clearBoqFromTender(body.id);
      return NextResponse.json({ tender, tenders: leanList() });
    }

    if (body?.action === "update-boq-line") {
      if (!body.id || !body.lineId) {
        return NextResponse.json({ error: "id and lineId required" }, { status: 400 });
      }
      const tender = updateBoqLine(body.id, body.lineId, body.linePatch || {});
      return NextResponse.json({ tender, tenders: leanList() });
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
      return NextResponse.json({ tender, tenders: leanList() });
    }

    if (body?.action === "delete-boq-lines") {
      if (!body.id || !body.lineIds?.length) {
        return NextResponse.json({ error: "id and lineIds required" }, { status: 400 });
      }
      const tender = deleteBoqLines(body.id, body.lineIds);
      return NextResponse.json({ tender, tenders: leanList() });
    }

    if (body?.action === "add-boq-sheet") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const result = addBoqSheetTab(body.id, body.sheetName);
      return NextResponse.json({
        tender: result.tender,
        tenders: leanList(),
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
        tenders: leanList(),
        sheetKey: result.sheetKey,
      });
    }

    if (body?.action === "delete-boq-sheet") {
      if (!body.id || !body.sheetKey) {
        return NextResponse.json({ error: "id and sheetKey required" }, { status: 400 });
      }
      const tender = deleteBoqSheetTab(body.id, body.sheetKey);
      return NextResponse.json({ tender, tenders: leanList() });
    }

    if (body?.action === "move-boq-lines") {
      if (!body.id || !body.lineIds?.length || !body.sheetName?.trim()) {
        return NextResponse.json({ error: "id, lineIds and sheetName required" }, { status: 400 });
      }
      const result = moveBoqLinesToSheet(body.id, body.lineIds, body.sheetName, {
        sourceSheet: body.sourceSheet || body.sheetKey,
      });
      return NextResponse.json({
        tender: result.tender,
        tenders: leanList(),
        sheetKey: result.sheetKey,
        movedCount: result.movedCount,
      });
    }

    if (body?.action === "merge-boq-lines") {
      if (!body.id || !body.sheetName?.trim()) {
        return NextResponse.json({ error: "id and sheetName required" }, { status: 400 });
      }
      if (!body.mergeWholeSource && !body.lineIds?.length) {
        return NextResponse.json({ error: "lineIds required" }, { status: 400 });
      }
      const result = mergeBoqLinesIntoSheet(body.id, {
        lineIds: body.lineIds,
        targetName: body.sheetName,
        sourceSheet: body.sourceSheet || body.sheetKey,
        mergeWholeSource: Boolean(body.mergeWholeSource),
      });
      return NextResponse.json({
        tender: result.tender,
        tenders: leanList(),
        sheetKey: result.sheetKey,
        movedCount: result.movedCount,
      });
    }

    if (body?.action === "move-boq-lines-to-section") {
      if (!body.id || !body.lineIds?.length || !body.targetSectionId) {
        return NextResponse.json({ error: "id, lineIds and targetSectionId required" }, { status: 400 });
      }
      const result = moveBoqLinesToSection(body.id, body.lineIds, {
        sheetKey: body.sheetKey || body.sourceSheet,
        targetSectionId: body.targetSectionId,
        newSectionName: body.newSectionName,
      });
      return NextResponse.json({
        tender: result.tender,
        tenders: leanList(),
        movedCount: result.movedCount,
        sectionLabel: result.sectionLabel,
      });
    }

    if (body?.action === "delete-document") {
      if (!body.id || !body.documentId) {
        return NextResponse.json({ error: "id and documentId required" }, { status: 400 });
      }
      const tender = removeTenderDocument(body.id, body.documentId);
      return NextResponse.json({ tender: leanOne(tender), tenders: leanList() });
    }

    if (body?.action === "create-document-folder") {
      if (!body.id || !body.folderName?.trim()) {
        return NextResponse.json({ error: "id and folderName required" }, { status: 400 });
      }
      const tender = addTenderDocumentFolder(body.id, {
        name: body.folderName,
        parentId: body.parentId,
      });
      return NextResponse.json({ tender: leanOne(tender), tenders: leanList() });
    }

    if (body?.action === "delete-document-folder") {
      if (!body.id || !body.folderId) {
        return NextResponse.json({ error: "id and folderId required" }, { status: 400 });
      }
      const tender = removeTenderDocumentFolder(body.id, body.folderId);
      return NextResponse.json({ tender: leanOne(tender), tenders: leanList() });
    }

    if (body?.action === "move-document") {
      if (!body.id || !body.documentId) {
        return NextResponse.json({ error: "id and documentId required" }, { status: 400 });
      }
      const tender = moveTenderDocument(body.id, body.documentId, {
        kind: body.kind,
        folderId: body.folderId,
      });
      return NextResponse.json({ tender: leanOne(tender), tenders: leanList() });
    }

    if (body?.action === "submit") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const tender = markTenderSubmitted(body.id, { tenderSum: body.tenderSum });
      return NextResponse.json({ tender: leanOne(tender), tenders: leanList() });
    }

    if (body?.action === "convert-won") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const result = convertTenderToPendingJob(body.id);
      return NextResponse.json({
        ...result,
        tender: result.tender ? leanOne(result.tender) : result.tender,
        tenders: leanList(),
      });
    }

    if (body?.action === "rebuild-job-cost-centres") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      try {
        const result = rebuildTenderJobCostCentres(body.id);
        return NextResponse.json({ ...result, tenders: leanList() });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to rebuild cost centres";
        return NextResponse.json({ error: message }, { status: 503 });
      }
    }

    if (body?.action === "sync-job-documents") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const result = syncTenderDocumentsToLinkedJob(body.id);
      return NextResponse.json({ ...result, tenders: leanList() });
    }

    if (body?.action === "sync-job-documents-from-job") {
      const jobKey = body.jobId || body.id;
      if (!jobKey) return NextResponse.json({ error: "jobId required" }, { status: 400 });
      const result = syncJobDocumentsFromSourceTender(jobKey);
      return NextResponse.json(result);
    }

    if (body?.action === "heal-job-cost-centres") {
      const jobKey = body.jobId || body.id;
      if (!jobKey) return NextResponse.json({ error: "jobId required" }, { status: 400 });
      const result = healJobCostCentresForJob(jobKey);
      // No tenders list — heal runs on every oversized job open and must stay tiny.
      return NextResponse.json(result);
    }

    if (body?.action === "rebuild-job-cost-centres-from-job") {
      const jobKey = body.jobId || body.id;
      if (!jobKey) return NextResponse.json({ error: "jobId required" }, { status: 400 });
      try {
        const result = rebuildJobCostCentresFromSourceTender(jobKey);
        return NextResponse.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to rebuild cost centres";
        return NextResponse.json({ error: message }, { status: 503 });
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const locked = recordLockErrorResponse(error);
    if (locked) return locked;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update tender" },
      { status: 400 },
    );
  }
}
