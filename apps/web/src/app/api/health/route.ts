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
      postcodeLookup: process.env.NEXA_POSTCODE_LOOKUP_VERSION ?? "street-list-v2",
    },
    checkedAt: new Date().toISOString(),
  });
}
