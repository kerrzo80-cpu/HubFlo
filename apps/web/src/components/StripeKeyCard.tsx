"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard, Loader2, Trash2, TriangleAlert } from "lucide-react";

type StripeStatus = {
  connected: boolean;
  source: "env" | "in-app" | "none";
  hasPublishableKey: boolean;
};

export function StripeKeyCard() {
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadStatus() {
    try {
      const res = await fetch("/api/integrations/stripe");
      if (res.ok) setStatus((await res.json()) as StripeStatus);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/integrations/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretKey, publishableKey, webhookSecret }),
      });
      const data = (await res.json().catch(() => null)) as (StripeStatus & { error?: string }) | null;
      if (!res.ok) {
        setError(data?.error || "Could not save Stripe keys.");
        return;
      }
      if (data) setStatus(data);
      setSecretKey("");
      setPublishableKey("");
      setWebhookSecret("");
      setMessage("Stripe connected — customers can Pay online on invoice links.");
    } catch {
      setError("Network error while saving Stripe keys.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/integrations/stripe", { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as StripeStatus | null;
      if (res.ok && data) {
        setStatus(data);
        setMessage("In-app Stripe keys removed.");
      }
    } catch {
      setError("Network error while removing keys.");
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(status?.connected);

  return (
    <article className="setup-integration-card">
      <header>
        <CreditCard size={18} />
        <div>
          <strong>Stripe payments</strong>
          <span>Card pay links on customer invoice portal</span>
        </div>
        <em className={connected ? "ok" : "warn"}>{connected ? "Connected" : "Not connected"}</em>
      </header>
      <p>
        {connected
          ? `Using ${status?.source === "env" ? "environment" : "in-app"} secret key. Webhook: /api/integrations/stripe/webhook`
          : "Paste test or live keys to enable Pay online. Bank-transfer notify still works without Stripe."}
      </p>
      <div className="setup-key-fields">
        <label>
          Secret key (sk_…)
          <input
            type="password"
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            placeholder={connected ? "•••••••• (leave blank to keep)" : "sk_live_… or sk_test_…"}
            autoComplete="off"
          />
        </label>
        <label>
          Publishable key (pk_…)
          <input
            type="text"
            value={publishableKey}
            onChange={(event) => setPublishableKey(event.target.value)}
            placeholder="pk_live_… (optional)"
            autoComplete="off"
          />
        </label>
        <label>
          Webhook secret (whsec_…)
          <input
            type="password"
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
            placeholder="whsec_… (recommended for live)"
            autoComplete="off"
          />
        </label>
      </div>
      <div className="portal-actions">
        <button type="button" className="primary-button" disabled={busy || (!secretKey && !connected)} onClick={() => void save()}>
          {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
          Save Stripe keys
        </button>
        {connected && status?.source === "in-app" ? (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={16} />
            Remove
          </button>
        ) : null}
      </div>
      {message ? (
        <p className="setup-key-ok">
          <Check size={14} /> {message}
        </p>
      ) : null}
      {error ? (
        <p className="setup-key-error">
          <TriangleAlert size={14} /> {error}
        </p>
      ) : null}
    </article>
  );
}
