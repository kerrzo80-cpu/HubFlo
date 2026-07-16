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
    },
    checkedAt: new Date().toISOString(),
  });
}
