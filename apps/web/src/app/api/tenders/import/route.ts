import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  addTenderDocument,
  importBoqRowsIntoTender,
  importTrackerRows,
  listTenders,
  type TenderDocumentKind,
} from "@/lib/tenders-data";
import {
  allSheetRowsFromWorkbookBuffer,
  sheetRowsFromWorkbookBuffer,
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
      let rows: string[][] = [];
      if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
        const text = bytes.toString("utf8");
        const delimiter = name.endsWith(".tsv") || text.includes("\t") ? "\t" : ",";
        rows = text.split(/\r?\n/).map((line) => line.split(delimiter));
      } else {
        // Client BoQs commonly split bill “pages” across worksheets — ingest all sheets.
        rows = allSheetRowsFromWorkbookBuffer(bytes);
      }
      const tender = importBoqRowsIntoTender(tenderId, rows);
      return NextResponse.json({ tender, tenders: listTenders() });
    }

    if (action === "upload-document") {
      const tenderId = String(formData.get("tenderId") || "").trim();
      const kind = (String(formData.get("kind") || "other") || "other") as TenderDocumentKind;
      if (!tenderId) return NextResponse.json({ error: "tenderId required" }, { status: 400 });

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
