import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  createTakeoffProject,
  getTakeoffProjects,
  type TakeoffProject,
} from "@/lib/takeoff-data";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(getTakeoffProjects());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<Partial<TakeoffProject>>(request);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const created = createTakeoffProject(payload);
  return NextResponse.json(created, { status: 201 });
}
