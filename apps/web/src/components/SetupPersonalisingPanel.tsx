"use client";

import { useRef, useState } from "react";
import { ImagePlus, Palette, Smartphone } from "lucide-react";

import type { BusinessBrandingSettings } from "@/lib/branding";

type Props = {
  businessSettings: BusinessBrandingSettings;
  requestHeaders: HeadersInit;
  onChange: (patch: Partial<BusinessBrandingSettings>) => void;
  onNotice: (message: string) => void;
  /** When set, only show that slice of the business form. */
  focus?: "Company" | "Personalising" | "Portal" | null;
};

export function SetupPersonalisingPanel({
  businessSettings,
  requestHeaders,
  onChange,
  onNotice,
  focus = null,
}: Props) {
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<"logo" | "icon" | null>(null);

  const showCompany = !focus || focus === "Company";
  const showPersonalising = !focus || focus === "Personalising";
  const showPortal = !focus || focus === "Portal";

  async function uploadAsset(kind: "logo" | "icon", file: File | null | undefined) {
    if (!file) return;
    setUploading(kind);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/branding/assets/${kind}`, {
        method: "POST",
        headers: requestHeaders,
        body,
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        url?: string;
        businessSettings?: BusinessBrandingSettings;
      } | null;
      if (!response.ok) throw new Error(result?.error || "Upload failed.");
      if (result?.businessSettings) {
        onChange(result.businessSettings);
      } else if (result?.url) {
        onChange(kind === "logo" ? { logoUrl: result.url, appIconUrl: result.url } : { appIconUrl: result.url });
      }
      onNotice(kind === "logo" ? "Company logo uploaded." : "Home-screen app icon uploaded.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not upload image.");
    } finally {
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
              Make Core, Field, Survey, Takeoffs and Heat Design feel like your company — logos, colours, app names and
              home-screen icons. NeXa stays hidden when white-label is on.
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
              <small>Colours apply across the platform. Logo appears on headers, PDFs and login.</small>
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
                <p>Used on Core, Field, login, PDFs and forms.</p>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  hidden
                  onChange={(event) => {
                    void uploadAsset("logo", event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <div className="personalising-upload-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={uploading === "logo"}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    <ImagePlus size={16} />
                    {uploading === "logo" ? "Uploading…" : "Upload logo"}
                  </button>
                </div>
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
                <img src={businessSettings.appIconUrl || businessSettings.logoUrl || "/ewg-logo.png"} alt="App icon preview" />
              </div>
              <div>
                <strong>Home-screen app icon</strong>
                <p>Shown when staff save Core / Field / Survey / Takeoffs / Heat Design to their home screen.</p>
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  hidden
                  onChange={(event) => {
                    void uploadAsset("icon", event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <div className="personalising-upload-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={uploading === "icon"}
                    onClick={() => iconInputRef.current?.click()}
                  >
                    <Smartphone size={16} />
                    {uploading === "icon" ? "Uploading…" : "Upload app icon"}
                  </button>
                </div>
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
              <strong>App names on home screens</strong>
              <small>These titles appear under the icon when an app is saved to the phone or tablet.</small>
            </div>
          </div>

          <div className="setup-form-grid">
            <label>
              Core
              <input value={businessSettings.coreAppName} onChange={(event) => onChange({ coreAppName: event.target.value })} />
            </label>
            <label>
              Field
              <input value={businessSettings.fieldAppName} onChange={(event) => onChange({ fieldAppName: event.target.value })} />
            </label>
            <label>
              Survey / Estimator
              <input value={businessSettings.surveyAppName} onChange={(event) => onChange({ surveyAppName: event.target.value })} />
            </label>
            <label>
              Takeoffs
              <input value={businessSettings.takeoffsAppName} onChange={(event) => onChange({ takeoffsAppName: event.target.value })} />
            </label>
            <label className="span-2">
              Heat Design
              <input value={businessSettings.heatDesignAppName} onChange={(event) => onChange({ heatDesignAppName: event.target.value })} />
            </label>
          </div>

          <div className="personalising-preview-row">
            {[
              { label: businessSettings.coreAppName, href: "/" },
              { label: businessSettings.fieldAppName, href: "/field" },
              { label: businessSettings.surveyAppName, href: "/survey" },
              { label: businessSettings.takeoffsAppName, href: "/takeoff" },
              { label: businessSettings.heatDesignAppName, href: "/heat-design" },
            ].map((app) => (
              <a key={app.href} className="personalising-home-preview" href={app.href} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={businessSettings.appIconUrl || businessSettings.logoUrl || "/ewg-logo.png"} alt="" />
                <span>{app.label}</span>
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
