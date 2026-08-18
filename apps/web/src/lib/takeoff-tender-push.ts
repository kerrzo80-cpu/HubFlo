/**
 * Server-side Takeoff → tender BoQ push (kept out of takeoff-data to avoid
 * circular imports with tenders-data).
 */

import { appendAuditEvent, type AuditEvent } from "@/lib/people-data";
import { getTakeoffRateLibrary } from "@/lib/takeoff-rate-library";
import {
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffProject,
} from "@/lib/takeoff-data";
import {
  buildTakeoffTenderBoqLines,
  mergeTakeoffBoqLines,
  previousTakeoffBoqSell,
} from "@/lib/takeoff-tender-export";
import { getTender, linkTakeoffToTender, updateTender } from "@/lib/tenders-data";
import { computeBoqTotal, type Tender } from "@/lib/tenders-types";

export type TakeoffTenderPushResult = {
  project: TakeoffProject;
  tender: Pick<Tender, "id" | "name" | "client" | "status" | "bidValue" | "tenderSum">;
  lineCount: number;
  sellTotal: number;
  sheetCount: number;
  auditEvent: AuditEvent;
};

/** Push Studio BoQ onto a linked Core tender — one sheet per house type when folders exist. */
export function pushTakeoffProjectToTender(
  projectId: string,
  tenderId: string,
  actor = "NeXa Takeoff",
): TakeoffTenderPushResult | null {
  const project = getTakeoffProject(projectId);
  if (!project) return null;
  if (project.status !== "Approved" && project.status !== "Pushed") return null;

  const tender = getTender(tenderId);
  if (!tender) return null;
  if (!project.studio) return null;

  const takeoffLines = buildTakeoffTenderBoqLines(project.studio, {
    library: getTakeoffRateLibrary(),
    projectRef: project.reference,
    documents: project.documents.map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      notes: doc.notes,
    })),
  });
  if (!takeoffLines.length) return null;

  const takeoffSell = previousTakeoffBoqSell(takeoffLines);
  const boqLines = mergeTakeoffBoqLines(tender.boqLines, takeoffLines);
  const boqTotal = computeBoqTotal(boqLines);
  const sheetNames = new Set(
    takeoffLines.map((line) => (line.sheet || "").trim()).filter(Boolean),
  );
  const measuredCount = takeoffLines.filter((line) => line.kind === "measured").length;

  const descriptionNote = `Takeoff ${project.reference} BoQ — ${measuredCount} line(s) across ${sheetNames.size} layer sheet(s)`;
  const nextMaterialsNote = tender.materialsNote?.includes("Takeoff")
    ? tender.materialsNote
    : [tender.materialsNote, descriptionNote].filter(Boolean).join("\n").trim();

  const updatedTender = updateTender(tender.id, {
    boqLines,
    materialsNote: nextMaterialsNote,
    status: tender.status === "Not Started" ? "In Progress" : tender.status,
    tenderSum: boqTotal,
    bidValue: boqTotal,
  });

  linkTakeoffToTender(project.id, project.reference, updatedTender.id);

  const pushedAt = new Date().toISOString();
  const updatedProject = updateTakeoffProject(project.id, {
    sourceTenderId: updatedTender.id,
    status: "Pushed",
    review: {
      ...project.review,
      pushedAt,
    },
  });
  if (!updatedProject) return null;

  const auditEvent = appendAuditEvent({
    actor,
    action: "updated",
    recordType: "tender",
    recordId: updatedTender.id,
    summary: `Takeoff ${project.reference} pushed ${measuredCount} BoQ line(s) into tender ${updatedTender.name} (${sheetNames.size} layer sheet(s)).`,
    source: "Takeoff",
    importance: "normal",
  });

  return {
    project: updatedProject,
    tender: {
      id: updatedTender.id,
      name: updatedTender.name,
      client: updatedTender.client,
      status: updatedTender.status,
      bidValue: updatedTender.bidValue,
      tenderSum: updatedTender.tenderSum,
    },
    lineCount: measuredCount,
    sellTotal: takeoffSell,
    sheetCount: sheetNames.size,
    auditEvent,
  };
}
