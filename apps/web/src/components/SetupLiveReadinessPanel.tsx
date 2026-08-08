"use client";

import { useEffect, useState } from "react";

type ReadinessCheck = {
  id: string;
  status: "ready" | "warning" | "blocked";
  label: string;
  detail: string;
};

type ReadinessResponse = {
  workspaceMode?: string;
  authMode?: string;
  counts?: Record<string, number>;
  checks?: ReadinessCheck[];
  openai?: { connected?: boolean; source?: string };
  backup?: { presentStoreCount?: number; storeCount?: number; totalBytes?: number };
};

type OpenAiStatus = {
  connected?: boolean;
  source?: string;
  model?: string;
  hasInAppKey?: boolean;
  envKeyName?: string;
};

function statusClass(status: string) {
  if (status === "ready") return "setup-status-label ready";
  if (status === "warning") return "setup-status-label warn";
  return "setup-status-label blocked";
}

export function SetupLiveReadinessPanel() {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [openai, setOpenai] = useState<OpenAiStatus | null>(null);
  const [smoke, setSmoke] = useState<string>("");
  const [backupNote, setBackupNote] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [readyRes, openaiRes, backupRes] = await Promise.all([
          fetch("/api/go-live/readiness", { cache: "no-store" }),
          fetch("/api/integrations/openai", { cache: "no-store" }),
          fetch("/api/prototype-backup?format=verify", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (readyRes.ok) setReadiness((await readyRes.json()) as ReadinessResponse);
        else setError(`Readiness ${readyRes.status}`);
        if (openaiRes.ok) setOpenai((await openaiRes.json()) as OpenAiStatus);
        if (backupRes.ok) {
          const body = await backupRes.json();
          const v = body.verification || body;
          setBackupNote(
            `${v.presentStoreCount ?? "?"} / ${v.storeCount ?? "?"} stores · ${Math.round((v.totalBytes || 0) / 1024)} KB`,
          );
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load readiness");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runOpenAiSmoke() {
    setSmoke("Checking…");
    try {
      const response = await fetch("/api/integrations/openai/smoke", { method: "POST" });
      const body = await response.json();
      setSmoke(body.ok ? `OpenAI OK (${body.ms}ms · ${body.source})` : `OpenAI failed: ${body.error || response.status}`);
    } catch (err) {
      setSmoke(err instanceof Error ? err.message : "Smoke failed");
    }
  }

  async function runBackupDryRun() {
    setBackupNote("Dry-run…");
    try {
      const exportRes = await fetch("/api/prototype-backup?format=json", { cache: "no-store" });
      if (!exportRes.ok) {
        setBackupNote(`Export failed (${exportRes.status})`);
        return;
      }
      const backup = await exportRes.json();
      const restoreRes = await fetch("/api/prototype-backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup, dryRun: true }),
      });
      const result = await restoreRes.json();
      if (!restoreRes.ok) {
        setBackupNote(result.error || `Dry-run failed (${restoreRes.status})`);
        return;
      }
      setBackupNote(
        `Dry-run OK — would write ${result.written?.length || 0} stores · skip ${result.skipped?.length || 0}`,
      );
    } catch (err) {
      setBackupNote(err instanceof Error ? err.message : "Dry-run failed");
    }
  }

  const checks = readiness?.checks || [];
  const blocked = checks.filter((c) => c.status === "blocked").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const buildLabel =
    error
      ? "Readiness unavailable"
      : blocked
        ? `${blocked} blocked`
        : warnings
          ? `${warnings} warning${warnings === 1 ? "" : "s"}`
          : "Ready for company pilot";

  return (
    <section className="setup-panel setup-readiness">
      <div className="documents-toolbar">
        <div>
          <span className="permission-heading">Live readiness</span>
          <h2>Ops checklist</h2>
        </div>
        <div className="setup-template-actions">
          <a className="secondary-button" href="/api/prototype-backup" download>
            Export pilot backup
          </a>
          <button type="button" className="secondary-button" onClick={() => void runBackupDryRun()}>
            Backup dry-run
          </button>
          <button type="button" className="secondary-button" onClick={() => void runOpenAiSmoke()}>
            OpenAI smoke
          </button>
          <span className={statusClass(blocked ? "blocked" : warnings ? "warning" : "ready")}>
            {buildLabel}
          </span>
        </div>
      </div>

      {error ? <p className="setup-inline-note">{error}</p> : null}
      {smoke ? <p className="setup-inline-note">{smoke}</p> : null}
      {backupNote ? <p className="setup-inline-note">Backup: {backupNote}</p> : null}

      <div className="setup-readiness-grid">
        {checks.map((check) => (
          <article key={check.id}>
            <span>{check.label}</span>
            <strong className={statusClass(check.status)}>{check.status}</strong>
            <small>{check.detail}</small>
          </article>
        ))}
        <article>
          <span>OpenAI key</span>
          <strong className={statusClass(openai?.connected ? "ready" : "blocked")}>
            {openai?.connected ? `connected (${openai.source})` : "missing"}
          </strong>
          <small>
            {openai?.envKeyName
              ? `Env ${openai.envKeyName}${openai.hasInAppKey ? " · in-app fallback saved" : ""} · model ${openai.model || "default"}`
              : "Configure in Setup → Integrations → Blake AI"}
          </small>
        </article>
        <article>
          <span>Backup / restore</span>
          <strong className={statusClass(backupNote.includes("Dry-run OK") || backupNote.includes("stores") ? "ready" : "warning")}>
            export + dry-run
          </strong>
          <small>
            Full restore needs Owner confirm + service restart. Auth passwords are never in the backup file.
          </small>
        </article>
        {readiness?.counts ? (
          <article>
            <span>Live counts</span>
            <strong>
              {readiness.counts.leads || 0} leads · {readiness.counts.quotes || 0} quotes · {readiness.counts.jobs || 0} jobs
            </strong>
            <small>
              Invoices {readiness.counts.invoices || 0} · surveys {readiness.counts.surveys || 0} · takeoffs{" "}
              {readiness.counts.takeoffs || 0}
            </small>
          </article>
        ) : null}
      </div>
    </section>
  );
}
