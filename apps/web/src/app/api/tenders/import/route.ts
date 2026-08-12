import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  addTenderDocument,
  getTender,
  importBoqIntoTender,
  importBoqWorkbookIntoTender,
  importTrackerRows,
  listTenders,
  resolveTenderDocumentFolderKind,
  type TenderDocumentKind,
} from "@/lib/tenders-data";
import { isTenderDocumentKind } from "@/lib/tender-document-folders";
import { workbookBoqSheetsFromPdfBuffer } from "@/lib/tender-boq-pdf";
import {
  sheetRowsFromWorkbookBuffer,
  workbookBoqSheetsFromBuffer,
} from "@/lib/tenders-xlsx";
import { saveUploadedRecordDocument } from "@/lib/record-documents";

export const runtime = "nodejs";

function canEdit(access: ReturnType<typeof getAccessProfileFromHeaders>) {
  return access.canCreateQuote || access.canEditJobs || access.showFinance || access.canCustomize;
}

function folderForKind(kind: TenderDocumentKind) {
  switch (kind) {
    case "issued-boq":
    case "priced-boq":
      return "office-private";
    case "form-of-tender":
      return "office-private";
    case "drawing":
      return "drawings";
    case "specification":
      return "specs";
    case "supplier-quote":
      return "supplier-quotes";
    default:
      return "office-private";
  }
}

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canEdit(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const action = String(formData.get("action") || "");
  const file = formData.get("file");
  if (!(typeof File !== "undefined" && file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();

    if (action === "import-tracker") {
      let rows: string[][] = [];
      if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
        const text = bytes.toString("utf8");
        rows = text.split(/\r?\n/).map((line) => line.split(name.endsWith(".tsv") ? "\t" : ","));
      } else {
        rows = sheetRowsFromWorkbookBuffer(bytes);
      }
      const result = importTrackerRows(rows);
      return NextResponse.json({
        ...result,
        message: `Imported tracker — ${result.created} created, ${result.updated} updated.`,
      });
    }

    if (action === "import-boq") {
      const tenderId = String(formData.get("tenderId") || "").trim();
      if (!tenderId) return NextResponse.json({ error: "tenderId required" }, { status: 400 });
      const modeRaw = String(formData.get("mode") || formData.get("boqImportMode") || "replace")
        .trim()
        .toLowerCase();
      const mode = modeRaw === "append" || modeRaw === "add" ? "append" : "replace";
      const appendSheetLabel =
        String(formData.get("appendSheetLabel") || "").trim() ||
        (file.name ? file.name.replace(/\.[^.]+$/, "").trim() : "") ||
        undefined;
      const importOptions = { mode, appendSheetLabel } as const;
      let tender;
      if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
        // Quote-aware parse keeps multi-line wording intact.
        tender = importBoqIntoTender(tenderId, bytes.toString("utf8"), undefined, importOptions);
      } else if (name.endsWith(".pdf") || file.type === "application/pdf") {
        // Text-based PDF → one sheet tab per page → same parse path as Excel.
        tender = importBoqWorkbookIntoTender(
          tenderId,
          await workbookBoqSheetsFromPdfBuffer(bytes, file.name || "boq.pdf"),
          undefined,
          importOptions,
        );
      } else {
        // One BoQ sheet tab per Excel worksheet — full cell text, all pages.
        tender = importBoqWorkbookIntoTender(
          tenderId,
          workbookBoqSheetsFromBuffer(bytes),
          undefined,
          importOptions,
        );
      }
      const added = tender.boqLines.length;
      const measured = tender.boqLines.filter((line) => line.kind === "measured").length;
      return NextResponse.json({
        tender,
        tenders: listTenders(),
        mode,
        measured,
        message:
          mode === "append"
            ? `Added lines to BoQ (${measured} measured · ${added} total line${added === 1 ? "" : "s"}).`
            : `BoQ replaced (${measured} measured · ${added} total line${added === 1 ? "" : "s"}).`,
      });
    }

    if (action === "upload-document") {
      const tenderId = String(formData.get("tenderId") || "").trim();
      const kindRaw = String(formData.get("kind") || "other") || "other";
      const folderIdRaw = String(formData.get("folderId") || "").trim();
      if (!tenderId) return NextResponse.json({ error: "tenderId required" }, { status: 400 });

      const tenderBefore = getTender(tenderId);
      if (!tenderBefore) return NextResponse.json({ error: "Tender not found." }, { status: 404 });

      let kind: TenderDocumentKind = isTenderDocumentKind(kindRaw) ? kindRaw : "other";
      let folderId: string | undefined = folderIdRaw || undefined;
      if (folderId) {
        if (isTenderDocumentKind(folderId)) {
          kind = folderId;
          folderId = undefined;
        } else {
          const folders = tenderBefore.documentFolders || [];
          if (!folders.some((folder) => folder.id === folderId)) {
            return NextResponse.json({ error: "Folder not found on this tender." }, { status: 400 });
          }
          kind = resolveTenderDocumentFolderKind(folders, folderId);
        }
      }

      const saved = saveUploadedRecordDocument({
        scope: "tender",
        recordRef: tenderId,
        folderId: folderForKind(kind),
        visibility: "Private",
        fileName: file.name || "upload.bin",
        mimeType: file.type || "application/octet-stream",
        bytes,
      });

      const tender = addTenderDocument(tenderId, {
        kind,
        folderId,
        name: saved.name,
        mimeType: saved.type,
        url: saved.fileUrl,
        note: String(formData.get("note") || "") || undefined,
      });

      return NextResponse.json({ tender, document: saved, tenders: listTenders() }, { status: 201 });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 400 },
    );
  }
}
