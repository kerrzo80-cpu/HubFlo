import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getServerStoreDirectory } from "@/lib/server-store";
import { buildMarkedUpPdf, buildTakeoffBoqXlsx } from "@/lib/takeoff-boq-export";
import { getTakeoffProject } from "@/lib/takeoff-data";
import { createDefaultTakeoffSkill } from "@/lib/takeoff-skill";
import { resolveStoredFilePath } from "@/lib/takeoff-pdf-extract";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  const skill = project.skill ?? createDefaultTakeoffSkill();
  const format = request.nextUrl.searchParams.get("format") || "xlsx";

  if (!skill.measured.length) {
    return NextResponse.json({ error: "Run measurement before exporting" }, { status: 409 });
  }

  if (format === "xlsx") {
    const buffer = buildTakeoffBoqXlsx({
      projectName: project.name,
      reference: project.reference,
      trade: skill.scope.trade,
      rows: skill.measured,
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${project.reference}-takeoff-boq.xlsx"`,
      },
    });
  }

  if (format === "marked-pdf") {
    const drawing = project.documents.find((document) => document.kind === "Drawing" && document.storageKey);
    if (!drawing?.storageKey) {
      return NextResponse.json({ error: "Upload a drawing PDF before exporting marked-up PDF" }, { status: 409 });
    }
    const filePath = resolveStoredFilePath(getServerStoreDirectory(), drawing.storageKey);
    if (!filePath) return NextResponse.json({ error: "Drawing file missing on server" }, { status: 404 });
    const sourcePdf = await readFile(filePath);
    const buffer = await buildMarkedUpPdf({
      sourcePdf,
      title: `${project.reference} · ${project.name}`,
      quantities: skill.measured
        .filter((row) => (row.tagMatches || []).some((match) => match.documentId === drawing.id && !match.excluded))
        .map((row) => ({
          label: row.code,
          quantity: row.quantity,
          unit: row.unit,
          confidence: row.confidence,
          matches: (row.tagMatches || [])
            .filter((match) => match.documentId === drawing.id && !match.excluded)
            .map((match) => ({
              pageNumber: match.pageNumber,
              text: match.text,
              x: match.x,
              y: match.y,
            })),
        })),
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${project.reference}-marked-takeoff.pdf"`,
      },
    });
  }

  return NextResponse.json({ error: "format must be xlsx or marked-pdf" }, { status: 400 });
}
