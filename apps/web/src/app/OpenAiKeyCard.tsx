"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Sparkles, Trash2, TriangleAlert } from "lucide-react";

type OpenAiStatus = {
  connected: boolean;
  source: "env" | "in-app" | "none";
  model: string;
  updatedAt?: string;
  envKeyName: string;
  hasInAppKey: boolean;
};

export function OpenAiKeyCard() {
  const [status, setStatus] = useState<OpenAiStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadStatus() {
    try {
      const res = await fetch("/api/integrations/openai");
      if (res.ok) setStatus((await res.json()) as OpenAiStatus);
    } catch {
      /* status stays null; the form still works */
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
      const res = await fetch("/api/integrations/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyDraft }),
      });
      const data = (await res.json().catch(() => null)) as (OpenAiStatus & { error?: string }) | null;
      if (!res.ok) {
        setError(data?.error || "Could not save the key.");
        return;
      }
      if (data) setStatus(data);
      setKeyDraft("");
      setMessage("OpenAI connected — Blake is now live across Core, Field, Survey and Takeoff.");
    } catch {
      setError("Network error while saving the key.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/integrations/openai", { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as OpenAiStatus | null;
      if (res.ok && data) {
        setStatus(data);
        setMessage("In-app key removed.");
      }
    } catch {
      setError("Network error while removing the key.");
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(status?.connected);
  const fromEnv = status?.source === "env";

  return (
    <section className="ai-key-card">
      <div className="ai-key-card__glow" aria-hidden />
      <header className="ai-key-card__head">
        <span className="ai-key-card__badge">
          <Sparkles size={18} />
        </span>
        <div>
          <span className="ai-key-card__eyebrow">Integrations</span>
          <h2>Blake AI · OpenAI</h2>
          <p>
            One key powers Blake everywhere — Takeoff extraction, Survey packs, the Field “Ask Blake” chat and the
            Core assistant.
          </p>
        </div>
        <span className={`ai-key-card__status ${connected ? "is-on" : "is-off"}`}>
          {connected ? <Check size={14} /> : <TriangleAlert size={14} />}
          {connected ? "Connected" : "Not connected"}
        </span>
      </header>

      <div className="ai-key-card__body">
        {fromEnv ? (
          <p className="ai-key-card__note">
            A key is set via the <code>{status?.envKeyName}</code> environment variable, which takes precedence. You can
            still save an in-app key below as a fallback.
          </p>
        ) : (
          <p className="ai-key-card__note">
            Paste an OpenAI API key to switch Blake AI on instantly — no redeploy required. Stored securely in your
            workspace and never shown again.
          </p>
        )}

        <div className="ai-key-card__row">
          <div className="ai-key-card__input">
            <KeyRound size={16} />
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-..."
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && keyDraft.trim() && !busy) save();
              }}
            />
          </div>
          <button
            type="button"
            className="ai-key-card__save"
            disabled={busy || keyDraft.trim().length < 8}
            onClick={save}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {status?.hasInAppKey ? "Update key" : "Connect"}
          </button>
        </div>

        <div className="ai-key-card__meta">
          <span>
            Model: <strong>{status?.model ?? "gpt-4.1-mini"}</strong>
          </span>
          {status?.hasInAppKey ? (
            <button type="button" className="ai-key-card__remove" disabled={busy} onClick={remove}>
              <Trash2 size={13} /> Remove in-app key
            </button>
          ) : null}
        </div>

        {message ? <p className="ai-key-card__ok">{message}</p> : null}
        {error ? <p className="ai-key-card__err">{error}</p> : null}
      </div>
    </section>
  );
}
