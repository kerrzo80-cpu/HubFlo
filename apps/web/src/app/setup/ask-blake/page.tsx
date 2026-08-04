"use client";

import { FormEvent, useEffect, useState } from "react";
import type { TenantAiPublicSettings } from "@/lib/tenancy/tenant-ai";

export default function TenantAiSettingsPage() {
  const [settings, setSettings] = useState<TenantAiPublicSettings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    const response = await fetch("/api/tenant/ai", { credentials: "include", cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as {
      settings?: TenantAiPublicSettings;
      error?: string;
    };
    if (!response.ok) {
      setError(body.error || "Could not load AI settings.");
      return;
    }
    setSettings(body.settings || null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tenant/ai", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          tone: settings.tone,
          assistantName: settings.assistantName,
          instructions: settings.instructions,
          tradeType: settings.tradeType,
          model: settings.model,
          permissions: settings.permissions,
          usageLimits: settings.usageLimits,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        settings?: TenantAiPublicSettings;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Save failed.");
      setSettings(body.settings || null);
      setApiKey("");
      setNotice("Ask Blake settings saved. Secret keys are never shown again.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tenant/ai", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeApiKey: true }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        settings?: TenantAiPublicSettings;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not revoke key.");
      setSettings(body.settings || null);
      setNotice("Tenant API key revoked — platform key will be used if configured.");
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Could not revoke key.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings && !error) return <main style={{ padding: 24 }}>Loading Ask Blake settings…</main>;

  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: 16 }}>
      <h1>Ask Blake — company AI</h1>
      <p className="muted">
        By default Blake uses the secure platform OpenAI key on the server. You may optionally supply a
        company key (encrypted at rest). Keys are never exposed to the browser after save.
      </p>
      {error ? <p className="feedback error">{error}</p> : null}
      {notice ? <p className="feedback">{notice}</p> : null}
      {settings ? (
        <form onSubmit={save} className="stack" style={{ gap: 12 }}>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
            />
            Enable Ask Blake for this company
          </label>
          <label>
            Assistant name
            <input
              value={settings.assistantName}
              onChange={(event) => setSettings({ ...settings, assistantName: event.target.value })}
            />
          </label>
          <label>
            Tone
            <input value={settings.tone} onChange={(event) => setSettings({ ...settings, tone: event.target.value })} />
          </label>
          <label>
            Trade type
            <input
              value={settings.tradeType}
              onChange={(event) => setSettings({ ...settings, tradeType: event.target.value })}
            />
          </label>
          <label>
            Instructions
            <textarea
              rows={4}
              value={settings.instructions}
              onChange={(event) => setSettings({ ...settings, instructions: event.target.value })}
            />
          </label>
          <label>
            Model
            <input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} />
          </label>
          <label>
            Daily request limit
            <input
              type="number"
              min={1}
              value={settings.usageLimits.dailyRequests}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  usageLimits: {
                    ...settings.usageLimits,
                    dailyRequests: Number(event.target.value) || settings.usageLimits.dailyRequests,
                  },
                })
              }
            />
          </label>

          <section className="soft-block">
            <strong>API key</strong>
            <p className="muted">
              Active source: <code>{settings.keySource}</code>
              {settings.hasTenantApiKey ? ` · tenant key ••••${settings.apiKeyLastFour}` : " · using platform key when available"}
            </p>
            <label>
              Set / rotate company OpenAI key (sk-…)
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder="Leave blank to keep current"
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            {settings.hasTenantApiKey ? (
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => void revokeKey()}>
                Revoke company key
              </button>
            ) : null}
          </section>

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "Saving…" : "Save Ask Blake settings"}
          </button>
        </form>
      ) : null}
    </main>
  );
}
