import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffDocument,
  type TakeoffMeasurement,
  type TakeoffRoom,
} from "@/lib/takeoff-data";

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
  const project = getTakeoffProject(id);
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
  const document: TakeoffDocument = {
    id: documentId,
    kind: "LiDAR scan",
    fileName: payload.exportFileName?.trim() || `${project.reference}-roomplan-${uploadedAt.slice(0, 10)}.json`,
    mimeType: "application/json",
    size: JSON.stringify(payload.raw ?? payload).length,
    storageKey: `room-scans/${project.id}/${documentId}.json`,
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

  const updated = updateTakeoffProject(id, {
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

  return NextResponse.json({
    project: updated,
    document,
    imported: {
      rooms: rooms.length,
      measurements: measurements.length,
    },
  }, { status: 201 });
}
