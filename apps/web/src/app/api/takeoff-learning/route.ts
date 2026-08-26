import { NextResponse } from "next/server";
import {
  recordTakeoffLearningEvent,
  takeoffLearningPreferences,
  type TakeoffLearningEventType,
} from "@/lib/takeoff-learning-store";
import type { TakeoffTradeId } from "@/lib/takeoff-skill";
import { blakeRecordKey, recordBlakeRejectedCodes } from "@/lib/blake-record-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set<TakeoffLearningEventType>([
  "ai_confirm",
  "ai_reject",
  "manual_linear",
  "scale_choice",
  "pipe_spec_choice",
]);

const ALLOWED_TRADES = new Set<TakeoffTradeId>([
  "architectural",
  "structural",
  "mechanical",
  "electrical",
  "plumbing",
  "heating",
  "civil",
]);

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((row) => String(row || "").trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return undefined;
}

export async function GET() {
  try {
    const preferences = takeoffLearningPreferences();
    return NextResponse.json({ ok: true, preferences });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load takeoff learning" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid learning event" }, { status: 400 });
    }
    const type = String(body.type || "").trim() as TakeoffLearningEventType;
    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ ok: false, error: "Invalid learning event type" }, { status: 400 });
    }

    const tradeRaw = typeof body.trade === "string" ? body.trade.trim() : "";
    const trade = ALLOWED_TRADES.has(tradeRaw as TakeoffTradeId) ? (tradeRaw as TakeoffTradeId) : undefined;

    recordTakeoffLearningEvent({
      type,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      actor: typeof body.actor === "string" ? body.actor : undefined,
      codes: asStringArray(body.codes ?? body.code),
      rejectedCodes: asStringArray(body.rejectedCodes),
      pipeSpecId: typeof body.pipeSpecId === "string" ? body.pipeSpecId : undefined,
      classificationId: typeof body.classificationId === "string" ? body.classificationId : undefined,
      scaleLabel: typeof body.scaleLabel === "string" ? body.scaleLabel : undefined,
      trade,
    });
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const rejected = asStringArray(body.rejectedCodes) || (type === "ai_reject" ? asStringArray(body.codes ?? body.code) : undefined);
    if (projectId && rejected?.length) {
      recordBlakeRejectedCodes(blakeRecordKey("takeoff", projectId), rejected);
    }

    return NextResponse.json({ ok: true, preferences: takeoffLearningPreferences() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to record takeoff learning" },
      { status: 500 },
    );
  }
}
