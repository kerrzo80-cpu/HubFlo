import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { openAiKeySource, resolveOpenAiApiKey } from "@/lib/openai-env";
import { currentStoreVerification, getLastFireDrillResult } from "@/lib/pilot-backup";
import { getServerStoreBackend } from "@/lib/server-store";
import { getSimproBridgeStatus } from "@/lib/simpro-bridge";
import { isSumUpConfigured, sumUpKeySource } from "@/lib/sumup-key-store";
import { getXeroAuthStatus } from "@/lib/xero-auth";
import { getWorkspaceMode } from "@/lib/workspace-mode";

/**
 * Thin company services monitor — statuses only, no secrets.
 * Lives inside NeXa so you do not need a separate monitoring product for early access.
 */
export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const openaiConnected = Boolean(resolveOpenAiApiKey());
  const backup = currentStoreVerification();
  const fireDrill = getLastFireDrillResult();
  const simpro = getSimproBridgeStatus();
  const xero = getXeroAuthStatus();
  const sumupConnected = isSumUpConfigured();
  const fireDrillFresh =
    Boolean(fireDrill?.ok) &&
    Boolean(fireDrill?.at) &&
    Date.now() - Date.parse(fireDrill!.at) <= 14 * 24 * 60 * 60 * 1000;

  const services = [
    {
      id: "nexa",
      label: "NeXa core",
      status: "ready" as const,
      detail: `${getWorkspaceMode()} workspace · ${getServerStoreBackend()} store`,
      required: true,
    },
    {
      id: "openai",
      label: "OpenAI / Blake",
      status: openaiConnected ? ("ready" as const) : ("blocked" as const),
      detail: openaiConnected ? `Key via ${openAiKeySource()}` : "No key configured",
      required: true,
    },
    {
      id: "backup",
      label: "Company backup",
      status: backup.ok && backup.presentStoreCount > 0 ? ("ready" as const) : ("warning" as const),
      detail: backup.ok
        ? `${backup.presentStoreCount}/${backup.storeCount} stores · ${Math.round(backup.totalBytes / 1024)} KB`
        : "Export unavailable",
      required: true,
    },
    {
      id: "restoreFireDrill",
      label: "Restore fire-drill",
      status: fireDrillFresh ? ("ready" as const) : fireDrill?.ok ? ("warning" as const) : ("blocked" as const),
      detail: fireDrill
        ? `${fireDrill.ok ? "pass" : "fail"} · ${fireDrill.storesMatched}/${fireDrill.storesChecked} · ${fireDrill.at}`
        : "Not run yet",
      required: true,
    },
    {
      id: "xero",
      label: "Xero",
      status: xero.connected ? ("ready" as const) : ("warning" as const),
      detail: xero.connected ? "Connected" : "Not connected (optional for early access)",
      required: false,
    },
    {
      id: "sumup",
      label: "SumUp",
      status: sumupConnected ? ("ready" as const) : ("warning" as const),
      detail: sumupConnected ? `Configured (${sumUpKeySource()})` : "Not connected (optional)",
      required: false,
    },
    {
      id: "simpro",
      label: "simPRO bridge",
      status: "ready" as const,
      detail: simpro.configured
        ? `${simpro.mode} bridge (optional until NeXa is system of record)`
        : "Not connected (optional)",
      required: false,
    },
  ];

  const requiredBlocked = services.filter((s) => s.required && s.status === "blocked").map((s) => s.id);

  return NextResponse.json({
    services,
    summary: {
      ready: requiredBlocked.length === 0,
      requiredBlocked,
      posture: "single-company production",
    },
    checkedAt: new Date().toISOString(),
  });
}
