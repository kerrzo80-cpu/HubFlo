import { NextResponse } from "next/server";

import { getServerStoreBackend } from "@/lib/server-store";

export async function GET() {
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
      fieldCoreLive: "daywork-disk-v2",
    },
    checkedAt: new Date().toISOString(),
  });
}
