"use client";

import { useState } from "react";
import { Palette, Smartphone } from "lucide-react";

import { FileDropZone } from "@/components/FileDropZone";
import {
  resolveBrandIconUrl,
  resolveBrandLogoUrl,
  type BrandAppKey,
  type BrandAppLogoField,
  type BusinessBrandingSettings,
} from "@/lib/branding";
import type { BrandingAssetKind } from "@/lib/branding-assets";
import { prepareBrandingImage } from "@/lib/branding-image";

type Props = {
  businessSettings: BusinessBrandingSettings;
  requestHeaders: HeadersInit;
  onChange: (patch: Partial<BusinessBrandingSettings>) => void;
  onNotice: (message: string) => void;
  /** When set, only show that slice of the business form. */
  focus?: "Company" | "Personalising" | "Portal" | null;
};

type AppLogoRow = {
  key: BrandAppKey;
  kind: BrandingAssetKind;
  field: BrandAppLogoField;
  nameField: keyof BusinessBrandingSettings;
  label: string;
  href: string;
};

const APP_LOGO_ROWS: AppLogoRow[] = [
  { key: "core", kind: "logo-core", field: "coreLogoUrl", nameField: "coreAppName", label: "Core", href: "/" },
  { key: "field", kind: "logo-field", field: "fieldLogoUrl", nameField: "fieldAppName", label: "Field", href: "/field" },
  {
    key: "survey",
    kind: "logo-survey",
    field: "surveyLogoUrl",
    nameField: "surveyAppName",
    label: "Survey",
    href: "/survey",
  },
  {
    key: "takeoffs",
    kind: "logo-takeoffs",
    field: "takeoffsLogoUrl",
    nameField: "takeoffsAppName",
    label: "Takeoffs",
    href: "/takeoff",
  },
  {
    key: "heat-design",
    kind: "logo-heat-design",
    field: "heatDesignLogoUrl",
    nameField: "heatDesignAppName",
    label: "Heat Design",
    href: "/heat-design",
  },
  {
    key: "trainer",
    kind: "logo-trainer",
    field: "trainerLogoUrl",
    nameField: "trainerAppName",
    label: "Trainer",
    href: "/train",
  },
];

const UPLOAD_TIMEOUT_MS = 45_000;

function authHeadersOnly(headers: HeadersInit): HeadersInit {
  const source = new Headers(headers);
  // Never force Content-Type on FormData — the browser must set the multipart boundary.
  source.delete("Content-Type");
  source.delete("content-type");
  return source;
}

export function SetupPersonalisingPanel({
  businessSettings,
  requestHeaders,
  onChange,
  onNotice,
  focus = null,
}: Props) {
  const [uploading, setUploading] = useState<BrandingAssetKind | null>(null);

  const showCompany = !focus || focus === "Company";
  const showPersonalising = !focus || focus === "Personalising";
  const showPortal = !focus || focus === "Portal";
  const busy = uploading !== null;

  async function uploadAsset(kind: BrandingAssetKind, file: File | null | undefined, notice: string) {
    if (!file || busy) return;
    setUploading(kind);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const prepared = await prepareBrandingImage(file, {
        // Trim padding. Prefer transparent PNG for chrome bars (blue rail / Field).
        // JPEG always gets a white plate so it never composites onto black.
        maxEdge: kind === "icon" ? 512 : 1024,
        square: kind === "icon",
        background: kind === "icon" ? "transparent" : file.type.includes("jpeg") || file.type.includes("jpg") ? "white" : "transparent",
      });
      const body = new FormData();
      body.append("file", prepared);
      const response = await fetch(`/api/branding/assets/${kind}`, {
        method: "POST",
        headers: authHeadersOnly(requestHeaders),
        body,
        signal: controller.signal,
      });
      const raw = await response.text();
      let result: { error?: string; url?: string; businessSettings?: BusinessBrandingSettings } | null = null;
      try {
        result = raw ? (JSON.parse(raw) as typeof result) : null;
      } catch {
        result = null;
      }
      if (!response.ok) {
        throw new Error(result?.error || `Upload failed (${response.status}).`);
      }
      if (result?.businessSettings) {
        onChange(result.businessSettings);
      } else if (result?.url) {
        if (kind === "logo") onChange({ logoUrl: result.url, appIconUrl: result.url });
        else if (kind === "icon") onChange({ appIconUrl: result.url });
        else {
          const row = APP_LOGO_ROWS.find((item) => item.kind === kind);
          if (row) onChange({ [row.field]: result.url });
        }
      } else {
        throw new Error("Upload finished but no image URL was returned.");
      }
      onNotice(notice);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        onNotice("Upload timed out — try a smaller PNG or JPG.");
      } else {
        onNotice(error instanceof Error ? error.message : "Could not upload image.");
      }
    } finally {
      window.clearTimeout(timeout);
      setUploading(null);
    }
  }

  return (
    <section className="setup-panel personalising-panel">
      <div className="documents-toolbar">
        <div>
          <span className="permission-heading">Business profile</span>
          <h2>
            {focus === "Personalising"
              ? "Personalising"
              : focus === "Portal"
                ? "Client portal"
                : focus === "Company"
                  ? "Company details"
                  : "Company and personalising"}
          </h2>
          {showPersonalising ? (
            <p className="setup-panel-lead">
              Make Core, Field, Survey, Takeoffs, Heat Design and Trainer feel like your company — logos per app,
              colours, app names and home-screen icons. NeXa stays hidden when white-label is on.
            </p>
          ) : null}
        </div>
        <span className="setup-status-label">{businessSettings.workspaceName}</span>
      </div>

      {showCompany ? (
        <div className="setup-form-grid">
          <label>
            Company name
            <input value={businessSettings.companyName} onChange={(event) => onChange({ companyName: event.target.value })} />
          </label>
          <label>
            Trading name
            <input value={businessSettings.tradingName} onChange={(event) => onChange({ tradingName: event.target.value })} />
          </label>
          <label>
            Workspace name
            <input value={businessSettings.workspaceName} onChange={(event) => onChange({ workspaceName: event.target.value })} />
          </label>
          <label>
            Default sender email
            <input value={businessSettings.defaultFromEmail} onChange={(event) => onChange({ defaultFromEmail: event.target.value })} />
          </label>
          <label>
            Contact email
            <input value={businessSettings.contactEmail} onChange={(event) => onChange({ contactEmail: event.target.value })} />
          </label>
          <label>
            Phone
            <input value={businessSettings.phone} onChange={(event) => onChange({ phone: event.target.value })} />
          </label>
          <label className="span-2">
            Address
            <input value={businessSettings.address} onChange={(event) => onChange({ address: event.target.value })} />
          </label>
          <label>
            VAT number
            <input value={businessSettings.vatNumber} onChange={(event) => onChange({ vatNumber: event.target.value })} />
          </label>
          <label>
            Company number
            <input value={businessSettings.companyNumber} onChange={(event) => onChange({ companyNumber: event.target.value })} />
          </label>
        </div>
      ) : null}

      {showPersonalising ? (
        <>
          <div className="personalising-section-head">
            <Palette size={18} />
            <div>
              <strong>Look & feel</strong>
              <small>Colours apply across the platform. Company logo appears on login, PDFs and forms.</small>
            </div>
          </div>

          <div className="setup-form-grid">
            <label>
              Brand primary colour
              <span className="personalising-color-row">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(businessSettings.brandPrimaryColor) ? businessSettings.brandPrimaryColor : "#157fa8"}
                  onChange={(event) => onChange({ brandPrimaryColor: event.target.value })}
                  aria-label="Pick primary colour"
                />
                <input
                  value={businessSettings.brandPrimaryColor}
                  onChange={(event) => onChange({ brandPrimaryColor: event.target.value })}
                  placeholder="#157fa8"
                />
              </span>
            </label>
            <label>
              Brand accent colour
              <span className="personalising-color-row">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(businessSettings.brandAccentColor) ? businessSettings.brandAccentColor : "#0f5f7d"}
                  onChange={(event) => onChange({ brandAccentColor: event.target.value })}
                  aria-label="Pick accent colour"
                />
                <input
                  value={businessSettings.brandAccentColor}
                  onChange={(event) => onChange({ brandAccentColor: event.target.value })}
                  placeholder="#0f5f7d"
                />
              </span>
            </label>
            <label className="span-2">
              Product name (replaces NeXa in chrome)
              <input
                value={businessSettings.productName}
                onChange={(event) => onChange({ productName: event.target.value })}
                placeholder="EWG"
              />
            </label>
            <label className="span-2 personalising-toggle">
              <input
                type="checkbox"
                checked={businessSettings.hidePlatformName}
                onChange={(event) => onChange({ hidePlatformName: event.target.checked })}
              />
              <span>
                <strong>Hide NeXa branding</strong>
                <small>Platform feels like {businessSettings.productName || businessSettings.companyName} for staff and home-screen apps.</small>
              </span>
            </label>
          </div>

          <div className="personalising-upload-grid">
            <article className="personalising-upload-card">
              <div className="personalising-upload-preview" style={{ borderColor: businessSettings.brandPrimaryColor }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={businessSettings.logoUrl || "/ewg-logo.png"} alt="Company logo preview" />
              </div>
              <div>
                <strong>Company logo</strong>
                <p>Used on login, PDFs, forms and as fallback when an app has no logo of its own.</p>
                <FileDropZone
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  disabled={busy}
                  label={uploading === "logo" ? "Uploading…" : "Drop logo here or click to browse"}
                  hint="PNG, JPEG, WebP, SVG"
                  onFiles={(picked) => void uploadAsset("logo", picked[0], "Company logo uploaded.")}
                />
                <label>
                  Or logo URL
                  <input
                    value={businessSettings.logoUrl}
                    onChange={(event) => onChange({ logoUrl: event.target.value })}
                    placeholder="/ewg-logo.png"
                  />
                </label>
              </div>
            </article>

            <article className="personalising-upload-card">
              <div className="personalising-upload-preview personalising-upload-preview-icon" style={{ borderColor: businessSettings.brandPrimaryColor }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={businessSettings.appIconUrl || businessSettings.logoUrl || "/ewg-logo.png"} alt="Default app icon preview" />
              </div>
              <div>
                <strong>Default home-screen icon</strong>
                <p>Used for any app that does not have its own logo uploaded below.</p>
                <FileDropZone
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  disabled={busy}
                  label={uploading === "icon" ? "Uploading…" : "Drop icon here or click to browse"}
                  hint="PNG, JPEG, WebP, SVG"
                  onFiles={(picked) => void uploadAsset("icon", picked[0], "Default home-screen icon uploaded.")}
                />
                <label>
                  Or icon URL
                  <input
                    value={businessSettings.appIconUrl}
                    onChange={(event) => onChange({ appIconUrl: event.target.value })}
                    placeholder="/ewg-logo.png"
                  />
                </label>
              </div>
            </article>
          </div>

          <div className="personalising-section-head">
            <Smartphone size={18} />
            <div>
              <strong>App names & logos</strong>
              <small>
                Each app can have its own logo for headers. Uploads keep the original shape — wide logos stay
                wide in the top bar. Home-screen icons are auto-built as a square mark from that logo. Leave
                blank to use the company logo / default icon.
              </small>
            </div>
          </div>

          <div className="personalising-app-logo-grid">
            {APP_LOGO_ROWS.map((app) => {
              const preview = resolveBrandLogoUrl(businessSettings, app.key);
              const nameValue = String(businessSettings[app.nameField] ?? "");
              const logoValue = businessSettings[app.field];
              return (
                <article key={app.kind} className="personalising-app-logo-card">
                  <div className="personalising-upload-preview" style={{ borderColor: businessSettings.brandPrimaryColor }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview} alt={`${app.label} logo preview`} />
                  </div>
                  <div>
                    <strong>{app.label}</strong>
                    <label>
                      App name
                      <input
                        value={nameValue}
                        onChange={(event) => onChange({ [app.nameField]: event.target.value })}
                      />
                    </label>
                    <FileDropZone
                      accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                      disabled={busy}
                      label={uploading === app.kind ? "Uploading…" : "Drop logo here or click"}
                      hint="PNG, JPEG, WebP, SVG"
                      onFiles={(picked) => void uploadAsset(app.kind, picked[0], `${app.label} logo uploaded.`)}
                    />
                    <div className="personalising-upload-actions">
                      {logoValue ? (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy}
                          onClick={() => onChange({ [app.field]: "" })}
                        >
                          Use default
                        </button>
                      ) : null}
                    </div>
                    <label>
                      Or logo URL
                      <input
                        value={logoValue}
                        onChange={(event) => onChange({ [app.field]: event.target.value })}
                        placeholder="Uses default icon when blank"
                      />
                    </label>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="personalising-preview-row">
            {APP_LOGO_ROWS.map((app) => (
              <a key={app.href} className="personalising-home-preview" href={app.href} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolveBrandIconUrl(businessSettings, app.key)} alt="" />
                <span>{String(businessSettings[app.nameField] ?? app.label)}</span>
              </a>
            ))}
          </div>
        </>
      ) : null}

      {showPortal ? (
        <div className="setup-form-grid">
          <label className="span-2">
            Client portal brand line
            <input
              value={businessSettings.clientPortalBrandLine}
              onChange={(event) => onChange({ clientPortalBrandLine: event.target.value })}
            />
          </label>
          <label className="span-2">
            Portal welcome text
            <textarea
              value={businessSettings.portalWelcomeText}
              onChange={(event) => onChange({ portalWelcomeText: event.target.value })}
              rows={3}
            />
          </label>
          <label className="span-2">
            Portal acceptance wording
            <textarea
              value={businessSettings.portalAcceptanceText}
              onChange={(event) => onChange({ portalAcceptanceText: event.target.value })}
              rows={3}
            />
          </label>
        </div>
      ) : null}

      <div className="setup-preview-card" style={{ borderTop: `4px solid ${businessSettings.brandPrimaryColor || "#157fa8"}` }}>
        <span>Form / portal preview</span>
        <strong>{businessSettings.companyName}</strong>
        <p>{businessSettings.clientPortalBrandLine}</p>
        <small>{businessSettings.portalWelcomeText}</small>
        <small>
          {businessSettings.address} · {businessSettings.contactEmail} · VAT {businessSettings.vatNumber}
        </small>
      </div>
    </section>
  );
}
