import { NextResponse } from "next/server";
import { employeeHeaderName } from "@/lib/access";
import { appendAuditEvent } from "@/lib/people-data";
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
    const actor = req.headers.get(employeeHeaderName) || "Office";
    if (body.reset) {
      const library = resetTakeoffRateLibrary();
      try {
        appendAuditEvent({
          actor,
          action: "rates_reset",
          recordType: "takeoff_rate_library",
          recordId: "workspace",
          summary: "Takeoff rate library reset to defaults",
          source: "takeoff add-on",
          importance: "normal",
        });
      } catch {
        // ignore
      }
      return NextResponse.json({ ok: true, library });
    }
    const library = saveTakeoffRateLibrary({
      rates: body.rates,
      assemblies: body.assemblies,
    });
    try {
      appendAuditEvent({
        actor,
        action: "rates_saved",
        recordType: "takeoff_rate_library",
        recordId: "workspace",
        summary: `Takeoff rates saved · ${library.rates.length} rates · ${library.assemblies.filter((row) => row.enabled).length} assemblies on`,
        source: "takeoff add-on",
        importance: "normal",
      });
    } catch {
      // ignore
    }
    return NextResponse.json({ ok: true, library });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save rate library" },
      { status: 500 },
    );
  }
}
