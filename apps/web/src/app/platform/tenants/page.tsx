"use client";

import { FormEvent, useEffect, useState } from "react";
import type { TenantModuleId, TenantRecord } from "@/lib/tenancy/types";

const MODULES: TenantModuleId[] = [
  "core",
  "field",
  "survey",
  "takeoff",
  "heat-design",
  "ask-blake",
  "xero",
  "simpro",
];

type TenantRow = TenantRecord & { urlHint?: string };

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#157fa8");
  const [logoUrl, setLogoUrl] = useState("");
  const [modules, setModules] = useState<TenantModuleId[]>([
    "core",
    "field",
    "survey",
    "takeoff",
    "ask-blake",
  ]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    const response = await fetch("/api/platform/tenants", { credentials: "include", cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as {
      tenants?: TenantRow[];
      error?: string;
    };
    if (!response.ok) {
      setError(body.error || "Platform admin only.");
      return;
    }
    setTenants(body.tenants || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createTenant(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/tenants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          primaryColor,
          logoUrl,
          enabledModules: modules,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
        tenant?: TenantRecord;
      };
      if (!response.ok) throw new Error(body.error || "Could not create company.");
      setNotice(`Created ${body.tenant?.name} — ${body.url}`);
      setName("");
      setSlug("");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create company.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="platform-tenants-page" style={{ maxWidth: 920, margin: "32px auto", padding: 16 }}>
      <h1>NeXa platform — companies</h1>
      <p className="muted">
        Super-admin: create tenants, assign modules, and generate <code>{"{slug}.nexaapp.com"}</code> URLs.
        Custom domains can be added to each tenant&apos;s host list later.
      </p>
      {error ? <p className="feedback error">{error}</p> : null}
      {notice ? <p className="feedback">{notice}</p> : null}

      <form onSubmit={createTenant} className="stack" style={{ gap: 12, marginBottom: 28 }}>
        <h2>New company</h2>
        <label>
          Company name
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Tenant slug
          <input
            required
            value={slug}
            placeholder="ewg"
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
          />
        </label>
        <label>
          Primary colour
          <input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} />
        </label>
        <label>
          Logo URL
          <input value={logoUrl} placeholder="/ewg-logo.png or https://…" onChange={(event) => setLogoUrl(event.target.value)} />
        </label>
        <fieldset>
          <legend>Enabled modules</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {MODULES.map((moduleId) => (
              <label key={moduleId} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={modules.includes(moduleId)}
                  onChange={(event) => {
                    setModules((current) =>
                      event.target.checked
                        ? [...current, moduleId]
                        : current.filter((item) => item !== moduleId),
                    );
                  }}
                />
                {moduleId}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "Creating…" : "Create company"}
        </button>
      </form>

      <h2>Tenants</h2>
      <div className="stack" style={{ gap: 10 }}>
        {tenants.map((tenant) => (
          <article key={tenant.id} className="soft-block">
            <strong>{tenant.name}</strong>
            <div>
              <code>{tenant.slug}</code> · {tenant.active ? "active" : "inactive"}
            </div>
            <div>
              URL: <code>{tenant.urlHint || `${tenant.slug}.nexaapp.com`}</code>
            </div>
            <div>Modules: {tenant.enabledModules.join(", ")}</div>
            <div>
              Brand: {tenant.branding.primaryColor}
              {tenant.branding.logoUrl ? ` · ${tenant.branding.logoUrl}` : ""}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
