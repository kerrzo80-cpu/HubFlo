import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { parseJsonRequestBody } from "@/lib/http";
import {
  getPublicTenantAiSettings,
  updateTenantAiSettings,
} from "@/lib/tenancy/tenant-ai";
import { withTenantFromRequest } from "@/lib/tenancy/with-tenant-request";

export const runtime = "nodejs";

function canManageAi(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  return Boolean(access.canCustomize || access.canEditJobs);
}

/** Tenant AI settings (Ask Blake) — never returns secret keys. */
export async function GET(request: Request) {
  try {
    return await withTenantFromRequest(request, async (tenant) => {
      if (!tenant.enabledModules.includes("ask-blake")) {
        return NextResponse.json({ error: "Ask Blake is not enabled for this company." }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        settings: getPublicTenantAiSettings(tenant.id),
      });
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load AI settings." },
      { status: status || 500 },
    );
  }
}

export async function PUT(request: Request) {
  if (!canManageAi(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return await withTenantFromRequest(request, async (tenant) => {
      const body = await parseJsonRequestBody<{
        enabled?: boolean;
        tone?: string;
        assistantName?: string;
        instructions?: string;
        tradeType?: string;
        model?: string;
        apiKey?: string;
        revokeApiKey?: boolean;
        permissions?: {
          canAnswerTrade?: boolean;
          canUseJobContext?: boolean;
          canProposeActions?: boolean;
        };
        usageLimits?: {
          dailyRequests?: number;
          monthlyTokens?: number;
        };
      }>(request);
      if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
      const user = getAuthenticatedUser(request);
      const current = getPublicTenantAiSettings(tenant.id);
      const settings = updateTenantAiSettings(
        tenant.id,
        {
          enabled: body.enabled,
          tone: body.tone,
          assistantName: body.assistantName,
          instructions: body.instructions,
          tradeType: body.tradeType,
          model: body.model,
          apiKey: body.apiKey,
          revokeApiKey: body.revokeApiKey,
          permissions: {
            canAnswerTrade: body.permissions?.canAnswerTrade ?? current.permissions.canAnswerTrade,
            canUseJobContext: body.permissions?.canUseJobContext ?? current.permissions.canUseJobContext,
            canProposeActions: body.permissions?.canProposeActions ?? current.permissions.canProposeActions,
          },
          usageLimits: {
            dailyRequests: body.usageLimits?.dailyRequests ?? current.usageLimits.dailyRequests,
            monthlyTokens: body.usageLimits?.monthlyTokens ?? current.usageLimits.monthlyTokens,
          },
        },
        user?.name || user?.username,
      );
      return NextResponse.json({ ok: true, settings });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save AI settings." },
      { status: 400 },
    );
  }
}
