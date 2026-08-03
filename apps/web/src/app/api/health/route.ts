import { NextResponse } from "next/server";

import { getServerStoreBackend } from "@/lib/server-store";
import { readDayworkSheetsStore } from "@/lib/daywork-sheets-store";

export async function GET() {
  let dayworkSheetCount = 0;
  let dayworkSignedCount = 0;
  try {
    const sheets = Object.values(readDayworkSheetsStore());
    dayworkSheetCount = sheets.length;
    dayworkSignedCount = sheets.filter(
      (sheet) => Boolean(String(sheet.plumberSignature || "").trim() && String(sheet.clientSignature || "").trim()),
    ).length;
  } catch {
    // Best-effort diagnostics only.
  }

  return NextResponse.json({
    ok: true,
    app: "nexa",
    store: getServerStoreBackend(),
    deployment: {
      branch: process.env.RENDER_GIT_BRANCH ?? "local",
      commit: process.env.RENDER_GIT_COMMIT ?? "local",
      talkLab: "/field/talk-lab",
      talkLabBuild: "realtime-voice-picker-v1",
      heatDesign: "/heat-design",
      heatDesignBuild: "floor-plan-kit-v1",
      fieldApp: "/field",
      fieldCoreLinked: true,
      photoCompressBuild: "shrink-v1",
      blakeAccent: "picker-v1",
      blakePeerEngineer: "v1",
      fieldHoursBuild: "time-check-v1",
      checklistUi: "tidy-v1",
      fieldCoreLive: "daywork-proven-v1",
    },
    daywork: {
      sheetCount: dayworkSheetCount,
      signedCount: dayworkSignedCount,
    },
    checkedAt: new Date().toISOString(),
  });
}
