"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard, Loader2, Trash2, TriangleAlert } from "lucide-react";

type SumUpStatus = {
  connected: boolean;
  source: "env" | "in-app" | "none";
  hasMerchantCode: boolean;
  merchantCode?: string;
};

export function SumUpKeyCard() {
  const [status, setStatus] = useState<SumUpStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [merchantCode, setMerchantCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadStatus() {
    try {
      const res = await fetch("/api/integrations/sumup");
      if (res.ok) setStatus((await res.json()) as SumUpStatus);
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
      const res = await fetch("/api/integrations/sumup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, merchantCode }),
      });
      const data = (await res.json().catch(() => null)) as (SumUpStatus & { error?: string }) | null;
      if (!res.ok) {
        setError(data?.error || "Could not save SumUp settings.");
        return;
      }
      if (data) setStatus(data);
      setApiKey("");
      setMerchantCode("");
      setMessage("SumUp connected — customers can Pay online with the same partner as the office reader.");
    } catch {
      setError("Network error while saving SumUp settings.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/integrations/sumup", { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as SumUpStatus | null;
      if (res.ok && data) {
        setStatus(data);
        setMessage("In-app SumUp settings removed.");
      }
    } catch {
      setError("Network error while removing settings.");
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
          <strong>SumUp payments</strong>
          <span>One partner for office reader + online invoice pay links</span>
        </div>
        <em className={connected ? "ok" : "warn"}>{connected ? "Connected" : "Not connected"}</em>
      </header>
      <p>
        {connected
          ? `Using ${status?.source === "env" ? "environment" : "in-app"} credentials${status?.merchantCode ? ` · merchant ${status.merchantCode}` : ""}. Paid portal checkouts update the invoice ledger and push to Xero when the invoice is exported. Webhook: /api/integrations/sumup/webhook`
          : "Paste API key + merchant code from SumUp Dashboard → Developers. Bank-transfer notify still works without this."}
      </p>
      <div className="setup-key-fields">
        <label>
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={connected ? "•••••••• (leave blank to keep)" : "SumUp API key"}
            autoComplete="off"
          />
        </label>
        <label>
          Merchant code
          <input
            type="text"
            value={merchantCode}
            onChange={(event) => setMerchantCode(event.target.value)}
            placeholder="MCxxxxxx"
            autoComplete="off"
          />
        </label>
      </div>
      <div className="portal-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || (!apiKey && !connected) || (!merchantCode && !status?.hasMerchantCode && !connected)}
          onClick={() => void save()}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
          Save SumUp
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
