import { NextResponse } from "next/server";
import {
  getTakeoffRateLibrary,
  resetTakeoffRateLibrary,
  saveTakeoffRateLibrary,
  type TakeoffAssemblyKit,
  type TakeoffRateEntry,
} from "@/lib/takeoff-rate-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, library: getTakeoffRateLibrary() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load rate library" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      rates?: TakeoffRateEntry[];
      assemblies?: TakeoffAssemblyKit[];
      reset?: boolean;
    } | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid rate library body" }, { status: 400 });
    }
    if (body.reset) {
      return NextResponse.json({ ok: true, library: resetTakeoffRateLibrary() });
    }
    const library = saveTakeoffRateLibrary({
      rates: body.rates,
      assemblies: body.assemblies,
    });
    return NextResponse.json({ ok: true, library });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save rate library" },
      { status: 500 },
    );
  }
}
