import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { isUserAuthenticationEnabled } from "@/lib/auth-store";
import { parseJsonRequestBody } from "@/lib/http";
import { createTenant, listTenants, updateTenant } from "@/lib/tenancy/tenant-store";
import { tenantUrlForSlug } from "@/lib/tenancy/resolve-tenant";
import type { TenantModuleId, TenantRecord } from "@/lib/tenancy/types";
import { withTenantFromRequest } from "@/lib/tenancy/with-tenant-request";

export const runtime = "nodejs";

function isPlatformAdmin(request: Request) {
  if (!isUserAuthenticationEnabled()) {
    // Pilot mode: allow Owner header for bootstrap demos only.
    const access = getAccessProfileFromHeaders(request.headers);
    return Boolean(access.canCustomize || access.canEditJobs);
  }
  const user = getAuthenticatedUser(request);
  if (!user) return false;
  if (user.role !== "Owner/Admin") return false;
  // Platform operators: env allow-list or EWG owner.
  const allow = (process.env.NEXA_PLATFORM_ADMIN_USERNAMES || "brian.kerr")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(user.username.toLowerCase());
}

/** Super-admin: list companies. */
export async function GET(request: Request) {
  if (!isPlatformAdmin(request)) {
    return NextResponse.json({ error: "Platform admin only." }, { status: 403 });
  }
  const tenants = listTenants().map((tenant) => ({
    ...tenant,
    urlHint: tenantUrlForSlug(tenant.slug),
  }));
  return NextResponse.json({ ok: true, tenants });
}

/** Super-admin: create a company tenant. */
export async function POST(request: Request) {
  if (!isPlatformAdmin(request)) {
    return NextResponse.json({ error: "Platform admin only." }, { status: 403 });
  }
  const body = await parseJsonRequestBody<{
    name?: string;
    slug?: string;
    logoUrl?: string;
    primaryColor?: string;
    accentColor?: string;
    contactEmail?: string;
    contactPhone?: string;
    vatNumber?: string;
    labourRate?: string;
    materialMarkupPercent?: string;
    templateFooter?: string;
    enabledModules?: TenantModuleId[];
    hosts?: string[];
  }>(request);
  if (!body?.name?.trim() || !body.slug?.trim()) {
    return NextResponse.json({ error: "name and slug are required." }, { status: 400 });
  }
  try {
    const tenant = createTenant({
      name: body.name,
      slug: body.slug,
      hosts: body.hosts,
      enabledModules: body.enabledModules,
      branding: {
        logoUrl: body.logoUrl || "",
        primaryColor: body.primaryColor,
        accentColor: body.accentColor,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        vatNumber: body.vatNumber,
      },
      commercial: {
        labourRate: body.labourRate,
        materialMarkupPercent: body.materialMarkupPercent,
        templateFooter: body.templateFooter,
      },
    });
    return NextResponse.json({
      ok: true,
      tenant,
      url: tenantUrlForSlug(tenant.slug),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create tenant." },
      { status: 400 },
    );
  }
}

/** Super-admin: patch tenant branding / modules (by id in body). */
export async function PATCH(request: Request) {
  if (!isPlatformAdmin(request)) {
    return NextResponse.json({ error: "Platform admin only." }, { status: 403 });
  }
  const body = await parseJsonRequestBody<Partial<TenantRecord> & { id?: string }>(request);
  if (!body?.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  try {
    const tenant = updateTenant(body.id, body);
    return NextResponse.json({ ok: true, tenant, url: tenantUrlForSlug(tenant.slug) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update tenant." },
      { status: 400 },
    );
  }
}

/** Convenience: current-host tenant admin update (company settings). */
export async function PUT(request: Request) {
  return withTenantFromRequest(request, async (tenant) => {
    const access = getAccessProfileFromHeaders(request.headers);
    if (!access.canEditJobs && !access.canCustomize) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await parseJsonRequestBody<Partial<TenantRecord>>(request);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const updated = updateTenant(tenant.id, {
      branding: body.branding,
      commercial: body.commercial,
      enabledModules: body.enabledModules,
      name: body.name,
      hosts: body.hosts,
      active: body.active,
    });
    return NextResponse.json({ ok: true, tenant: updated });
  });
}
