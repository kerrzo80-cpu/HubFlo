import { NextResponse } from "next/server";

import { getServerStoreBackend } from "@/lib/server-store";
import { readDayworkSheetsStore } from "@/lib/daywork-sheets-store";
import { readDayworkWriteLog } from "@/lib/daywork-write-log";
import { hostFromRequest } from "@/lib/tenancy/request-context";
import { resolveTenantFromHost } from "@/lib/tenancy/resolve-tenant";
import { migrateLegacyStoresForEwg } from "@/lib/tenancy/tenant-server-store";
import { listTenants } from "@/lib/tenancy/tenant-store";

export async function GET(request: Request) {
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

  const writeLog = readDayworkWriteLog();
  const lastWrite = writeLog.attempts[0] || null;
  const host = hostFromRequest(request);
  let tenant = null;
  try {
    migrateLegacyStoresForEwg();
    tenant = resolveTenantFromHost(host);
  } catch {
    // ignore
  }

  return NextResponse.json({
    ok: true,
    app: "nexa",
    store: getServerStoreBackend(),
    multiTenant: {
      enabled: true,
      rootDomain: process.env.NEXA_ROOT_DOMAIN || "nexaapp.com",
      tenantCount: listTenants().length,
      resolvedTenantId: tenant?.tenant.id || null,
      resolvedTenantSlug: tenant?.tenant.slug || null,
      host,
    },
    deployment: {
      branch: process.env.RENDER_GIT_BRANCH ?? "local",
      commit: process.env.RENDER_GIT_COMMIT ?? "local",
      service:
        process.env.RENDER_SERVICE_NAME ||
        (process.env.NEXT_PUBLIC_APP_URL?.includes("nexa-live")
          ? "nexa-live"
          : process.env.NEXT_PUBLIC_APP_URL?.includes("nexa-pilot")
            ? "nexa-pilot"
            : "local"),
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
      talkLab: "/field/talk-lab",
      talkLabBuild: "realtime-voice-picker-v1",
      heatDesign: "/heat-design",
      heatDesignBuild: "remove-core-heat-calc-tab-v1",
      fieldApp: "/field",
      fieldCoreLinked: true,
      photoCompressBuild: "shrink-v1",
      blakeAccent: "picker-v1",
      blakePeerEngineer: "v1",
      fieldHoursBuild: "time-check-v1",
      checklistUi: "tidy-v1",
      fieldCoreLive: "multi-tenant-saas-m1",
    },
    daywork: {
      sheetCount: dayworkSheetCount,
      signedCount: dayworkSignedCount,
      lastWrite,
    },
    checkedAt: new Date().toISOString(),
  });
}
