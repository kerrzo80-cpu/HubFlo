import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  attachSurveyEvidenceToQuote,
  createTakeoffProject,
  getTakeoffProject,
  getTakeoffProjects,
  updateTakeoffProject,
  type TakeoffDocument,
  type TakeoffMeasurement,
  type TakeoffRoom,
} from "@/lib/takeoff-data";
import { getJobs, getQuotes } from "@/lib/workflow-data";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

type RoomScanRoomPayload = {
  id?: string;
  name?: string;
  level?: string;
  notes?: string;
  confidence?: string;
  lengthM?: number | string;
  widthM?: number | string;
  heightM?: number | string;
  areaM2?: number | string;
  windowAreaM2?: number | string;
  outsideWalls?: number | string;
  dimensions?: UnknownRecord;
  openings?: Array<{
    type?: string;
    widthM?: number | string;
    heightM?: number | string;
    areaM2?: number | string;
    quantity?: number | string;
  }>;
};

type RoomScanPayload = {
  actor?: string;
  captureId?: string;
  capturedAt?: string;
  deviceName?: string;
  exportFileName?: string;
  returnUrl?: string;
  room?: RoomScanRoomPayload;
  rooms?: RoomScanRoomPayload[];
  raw?: unknown;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalised = value.replace(",", ".").replace(/[^0-9.-]+/g, "");
    const parsed = Number(normalised);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstNumber(record: UnknownRecord | null | undefined, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = numberFromUnknown(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function round(value: number, places = 2) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function importedRoomName(room: RoomScanRoomPayload, index: number) {
  return room.name?.trim() || `Room scan ${index + 1}`;
}

function openingArea(room: RoomScanRoomPayload) {
  return (room.openings ?? []).reduce((total, opening) => {
    const explicit = numberFromUnknown(opening.areaM2);
    if (explicit !== undefined) return total + explicit;

    const width = numberFromUnknown(opening.widthM);
    const height = numberFromUnknown(opening.heightM);
    const quantity = numberFromUnknown(opening.quantity) ?? 1;
    if (width === undefined || height === undefined) return total;
    return total + width * height * quantity;
  }, 0);
}

function toTakeoffRoom(room: RoomScanRoomPayload, index: number, documentId: string): TakeoffRoom {
  const dimensions = asRecord(room.dimensions);
  const lengthM = numberFromUnknown(room.lengthM)
    ?? firstNumber(dimensions, ["lengthM", "length", "depthM", "depth", "z"]);
  const widthM = numberFromUnknown(room.widthM)
    ?? firstNumber(dimensions, ["widthM", "width", "x"]);
  const heightM = numberFromUnknown(room.heightM)
    ?? firstNumber(dimensions, ["heightM", "height", "y"]);
  const areaM2 = numberFromUnknown(room.areaM2)
    ?? (lengthM !== undefined && widthM !== undefined ? lengthM * widthM : 0);
  const windowAreaM2 = numberFromUnknown(room.windowAreaM2) ?? openingArea(room);

  return {
    id: `lidar-room-${documentId}-${index}`,
    name: importedRoomName(room, index),
    level: room.level?.trim() || "Ground",
    lengthM: lengthM !== undefined ? round(lengthM) : undefined,
    widthM: widthM !== undefined ? round(widthM) : undefined,
    heightM: heightM !== undefined ? round(heightM) : undefined,
    outsideWalls: numberFromUnknown(room.outsideWalls) ?? 1,
    windowAreaM2: round(windowAreaM2),
    construction: "Average",
    glazing: "Double glazed",
    areaM2: round(areaM2),
    heatLoadWatts: 0,
    notes: [
      "Imported from NeXa Field LiDAR/RoomPlan scan.",
      room.confidence ? `Capture confidence: ${room.confidence}.` : "",
      room.notes?.trim() || "",
    ].filter(Boolean).join(" "),
  };
}

function roomMeasurements(room: TakeoffRoom, documentId: string): TakeoffMeasurement[] {
  const rows: TakeoffMeasurement[] = [
    {
      id: `lidar-measure-${documentId}-${room.id}-area`,
      roomId: room.id,
      label: `${room.name} floor area`,
      quantity: room.areaM2,
      unit: "m2",
      source: "LiDAR",
    },
  ];

  if (room.heightM !== undefined) {
    rows.push({
      id: `lidar-measure-${documentId}-${room.id}-height`,
      roomId: room.id,
      label: `${room.name} ceiling height`,
      quantity: room.heightM,
      unit: "m",
      source: "LiDAR",
    });
  }

  if (room.lengthM !== undefined && room.widthM !== undefined) {
    rows.push({
      id: `lidar-measure-${documentId}-${room.id}-perimeter`,
      roomId: room.id,
      label: `${room.name} estimated perimeter`,
      quantity: round((room.lengthM + room.widthM) * 2),
      unit: "m",
      source: "LiDAR",
    });
  }

  if (room.windowAreaM2 !== undefined && room.windowAreaM2 > 0) {
    rows.push({
      id: `lidar-measure-${documentId}-${room.id}-glazing`,
      roomId: room.id,
      label: `${room.name} glazing/opening area`,
      quantity: room.windowAreaM2,
      unit: "m2",
      source: "LiDAR",
    });
  }

  return rows;
}

function quoteFromLookup(value: string) {
  const lookup = value.trim().toLowerCase();
  if (!lookup) return undefined;
  return getQuotes().find((quote) => quote.id.toLowerCase() === lookup || quote.ref.toLowerCase() === lookup);
}

function jobFromLookup(value: string) {
  const lookup = value.trim().toLowerCase();
  if (!lookup) return undefined;
  return getJobs().find((job) => job.id.toLowerCase() === lookup || job.ref.toLowerCase() === lookup);
}

function projectLinkedToQuote(quoteId: string, quoteRef: string) {
  return getTakeoffProjects().find((project) => project.linkedQuoteId === quoteId || project.linkedQuoteRef === quoteRef);
}

function projectLinkedToJob(jobId: string, jobRef: string) {
  return getTakeoffProjects().find((project) => project.linkedJobId === jobId || project.linkedJobRef === jobRef);
}

function escapeSvgText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function roomPlanPreviewImageDataUrl(rooms: TakeoffRoom[], payload: RoomScanPayload) {
  const room = rooms[0];
  if (!room) return undefined;

  const length = room.lengthM ?? Math.sqrt(Math.max(room.areaM2, 1) * 1.25);
  const width = room.widthM ?? room.areaM2 / Math.max(length, 1);
  const aspect = Math.max(0.55, Math.min(1.8, length / Math.max(width, 0.1)));
  const planWidth = aspect >= 1 ? 290 : 220;
  const planHeight = aspect >= 1 ? 220 : 290;
  const x = (420 - planWidth) / 2;
  const y = 58;
  const rawRoom = Array.isArray(payload.rooms) ? payload.rooms[0] : payload.room;
  const openings = rawRoom?.openings ?? [];
  const openingMarks = openings.slice(0, 8).map((opening, index) => {
    const topSide = index % 2 === 0;
    const fraction = (index + 1) / (openings.length + 1);
    const markX = x + planWidth * fraction - 18;
    const markY = topSide ? y - 4 : y + planHeight - 2;
    const label = opening.type?.trim() || "Opening";
    return `<g><rect x="${markX}" y="${markY}" width="36" height="6" rx="3" fill="#3fb7df"/><text x="${markX + 18}" y="${topSide ? markY - 7 : markY + 21}" text-anchor="middle" font-family="Arial" font-size="9" fill="#406070">${escapeSvgText(label)}</text></g>`;
  }).join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="420" height="320" viewBox="0 0 420 320">
      <rect width="420" height="320" rx="24" fill="#f4fbfd"/>
      <rect x="18" y="18" width="384" height="284" rx="18" fill="#ffffff" stroke="#b7dceb"/>
      <text x="32" y="42" font-family="Arial" font-size="14" font-weight="700" fill="#162532">NeXa LiDAR room scan</text>
      <text x="32" y="62" font-family="Arial" font-size="11" fill="#6a7a88">${escapeSvgText(room.name)}</text>
      <rect x="${x}" y="${y}" width="${planWidth}" height="${planHeight}" rx="10" fill="#e9f7fb" stroke="#14345f" stroke-width="6"/>
      ${openingMarks}
      <line x1="${x}" y1="${y + planHeight + 30}" x2="${x + planWidth}" y2="${y + planHeight + 30}" stroke="#d4af37" stroke-width="3"/>
      <text x="${x + planWidth / 2}" y="${y + planHeight + 50}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#162532">${round(length)}m length</text>
      <line x1="${x - 30}" y1="${y}" x2="${x - 30}" y2="${y + planHeight}" stroke="#d4af37" stroke-width="3"/>
      <text x="${x - 44}" y="${y + planHeight / 2}" transform="rotate(-90 ${x - 44} ${y + planHeight / 2})" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#162532">${round(width)}m width</text>
      <text x="32" y="282" font-family="Arial" font-size="11" fill="#6a7a88">Area ${round(room.areaM2)}m² · Height ${room.heightM ? `${round(room.heightM)}m` : "review"} · Openings ${openings.length}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote && !access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<RoomScanPayload>(request);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = await params;
  let project = getTakeoffProject(id);
  if (!project) {
    const linkedQuote = quoteFromLookup(id);
    if (linkedQuote) {
      project = projectLinkedToQuote(linkedQuote.id, linkedQuote.ref) ?? createTakeoffProject({
        linkedQuoteId: linkedQuote.id,
        name: `${linkedQuote.description} survey`,
        customer: linkedQuote.customer,
        description: linkedQuote.description,
      });
    }
  }
  if (!project) {
    const linkedJob = jobFromLookup(id);
    if (linkedJob) {
      project = projectLinkedToJob(linkedJob.id, linkedJob.ref) ?? createTakeoffProject({
        linkedJobId: linkedJob.id,
        linkedJobRef: linkedJob.ref,
        name: `${linkedJob.description} survey`,
        customer: linkedJob.customer,
        site: linkedJob.site,
        description: linkedJob.description,
      });
    }
  }
  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  const scanRooms = Array.isArray(payload.rooms) && payload.rooms.length
    ? payload.rooms
    : payload.room
      ? [payload.room]
      : [];

  if (!scanRooms.length) {
    return NextResponse.json({ error: "Room scan must include at least one room." }, { status: 400 });
  }

  const uploadedAt = payload.capturedAt || new Date().toISOString();
  const documentId = `lidar-doc-${randomUUID()}`;
  const actor = payload.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Field";
  const rooms = scanRooms.map((room, index) => toTakeoffRoom(room, index, documentId));
  const measurements = rooms.flatMap((room) => roomMeasurements(room, documentId));
  const previewImageDataUrl = roomPlanPreviewImageDataUrl(rooms, payload);
  const document: TakeoffDocument = {
    id: documentId,
    kind: "LiDAR scan",
    fileName: payload.exportFileName?.trim() || `${project.reference}-roomplan-${uploadedAt.slice(0, 10)}.json`,
    mimeType: "application/json",
    size: JSON.stringify(payload.raw ?? payload).length,
    storageKey: `room-scans/${project.id}/${documentId}.json`,
    previewImageDataUrl,
    uploadedAt,
    status: "Parsed",
    notes: [
      `Captured by ${actor}${payload.deviceName ? ` on ${payload.deviceName}` : ""}.`,
      `${rooms.length} room${rooms.length === 1 ? "" : "s"} imported from LiDAR/RoomPlan.`,
      "Office must confirm room names, openings and heat-loss assumptions before quote issue.",
    ],
  };

  const importedRoomSummary = rooms
    .map((room) => `${room.name}${room.areaM2 ? ` (${room.areaM2}m2)` : ""}`)
    .join(", ");
  const surveyChat = [
    ...(project.surveyChat ?? []),
    {
      id: `survey-chat-lidar-${randomUUID()}`,
      role: "assistant" as const,
      text: `LiDAR scan received from ${actor}: ${importedRoomSummary}. I have added the rooms and measurements to Takeoff for office review.`,
      createdAt: new Date().toISOString(),
    },
  ];

  const updated = updateTakeoffProject(project.id, {
    status: project.status === "Draft" ? "In review" : project.status,
    documents: [document, ...project.documents],
    rooms: [...rooms, ...project.rooms],
    measurements: [...measurements, ...project.measurements],
    surveyChat,
    review: {
      ...project.review,
      riskFlags: Array.from(new Set([
        ...project.review.riskFlags,
        "LiDAR room dimensions need office review before quote issue",
      ])),
    },
  });

  if (!updated) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  const quoteAttachment = updated.linkedQuoteId
    ? attachSurveyEvidenceToQuote(updated.id, updated.linkedQuoteId, actor)
    : null;

  return NextResponse.json({
    project: updated,
    document,
    quoteAttachment,
    imported: {
      rooms: rooms.length,
      measurements: measurements.length,
    },
  }, { status: 201 });
}
