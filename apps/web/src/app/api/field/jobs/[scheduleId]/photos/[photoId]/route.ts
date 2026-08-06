import { NextResponse } from "next/server";

import { readFieldPhotoBytes } from "@/lib/field/field-photo-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string; photoId: string }> };

/** Serve synced Field job photo/file bytes. */
export async function GET(_request: Request, { params }: Params) {
  const { scheduleId, photoId } = await params;
  const photo = readFieldPhotoBytes(scheduleId, photoId);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(photo.buffer), {
    status: 200,
    headers: {
      "Content-Type": photo.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${photo.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
