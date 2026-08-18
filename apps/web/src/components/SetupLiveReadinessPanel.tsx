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
  companyProduction?: {
    ready?: boolean;
    blockers?: string[];
    warnings?: string[];
    posture?: string;
    note?: string;
  };
  fireDrill?: {
    ok?: boolean;
    at?: string;
    storesMatched?: number;
    storesChecked?: number;
    ms?: number;
  } | null;
};

type OpenAiStatus = {
  connected?: boolean;
  source?: string;
  model?: string;
  hasInAppKey?: boolean;
  envKeyName?: string;
};

type ServiceRow = {
  id: string;
  label: string;
  status: "ready" | "warning" | "blocked";
  detail: string;
  required?: boolean;
};

type OfficeBackupRecord = {
  filename: string;
  createdAt: string;
  bytes: number;
  destination?: string;
  sqliteIncluded?: boolean;
  fileDirs?: string[];
};

type OfficeBackupStatus = {
  lastOkAt?: string;
  lastRunAt?: string;
  lastError?: string;
  lastFilename?: string;
  lastBytes?: number;
  running?: boolean;
  s3Configured?: boolean;
  backups?: OfficeBackupRecord[];
  note?: string;
};

function formatBytes(bytes?: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso?: string) {
  if (!iso) return "Never";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

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
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [officeBackup, setOfficeBackup] = useState<OfficeBackupStatus | null>(null);
  const [officeBackupBusy, setOfficeBackupBusy] = useState(false);

  async function refresh() {
    const [readyRes, openaiRes, backupRes, servicesRes, officeRes] = await Promise.all([
      fetch("/api/go-live/readiness", { cache: "no-store" }),
      fetch("/api/integrations/openai", { cache: "no-store" }),
      fetch("/api/prototype-backup?format=verify", { cache: "no-store" }),
      fetch("/api/ops/services", { cache: "no-store" }),
      fetch("/api/office-backup", { cache: "no-store" }),
    ]);
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
    if (servicesRes.ok) {
      const body = await servicesRes.json();
      setServices(Array.isArray(body.services) ? body.services : []);
    }
    if (officeRes.ok) {
      setOfficeBackup((await officeRes.json()) as OfficeBackupStatus);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load readiness");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runOfficeBackupNow() {
    setOfficeBackupBusy(true);
    try {
      const response = await fetch("/api/office-backup", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setOfficeBackup((current) => ({
          ...(current || {}),
          lastError: body.error || `Backup failed (${response.status})`,
        }));
        return;
      }
      setOfficeBackup((body.status || body) as OfficeBackupStatus);
      await refresh();
    } catch (err) {
      setOfficeBackup((current) => ({
        ...(current || {}),
        lastError: err instanceof Error ? err.message : "Backup failed",
      }));
    } finally {
      setOfficeBackupBusy(false);
    }
  }

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

  async function runFireDrill() {
    setBackupNote("Fire-drill…");
    try {
      const response = await fetch("/api/prototype-backup/fire-drill", { method: "POST" });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setBackupNote(
          `Fire-drill failed — ${body.mismatches?.[0]?.reason || body.error || response.status}`,
        );
      } else {
        setBackupNote(
          `Fire-drill OK — ${body.storesMatched}/${body.storesChecked} stores · ${body.ms}ms · cleaned ${body.cleaned}`,
        );
      }
      await refresh();
    } catch (err) {
      setBackupNote(err instanceof Error ? err.message : "Fire-drill failed");
    }
  }

  const checks = readiness?.checks || [];
  const company = readiness?.companyProduction;
  const companyReady = Boolean(company?.ready);
  const blocked = (company?.blockers || []).length;
  const warnings = (company?.warnings || []).length;
  const buildLabel = error
    ? "Readiness unavailable"
    : companyReady
      ? "Company production ready"
      : blocked
        ? `${blocked} blocker${blocked === 1 ? "" : "s"}`
        : warnings
          ? `${warnings} warning${warnings === 1 ? "" : "s"}`
          : "Almost ready";

  const latestBackup = officeBackup?.backups?.[0];
  const backupStatus = officeBackupBusy || officeBackup?.running
    ? "warning"
    : officeBackup?.lastError
      ? "blocked"
      : officeBackup?.lastOkAt
        ? "ready"
        : "warning";

  return (
    <>
    <section className="setup-panel setup-readiness">
      <div className="documents-toolbar">
        <div>
          <span className="permission-heading">Keep office information safe</span>
          <h2>Office backups</h2>
          <p className="setup-panel-lead">
            Saves jobs, tenders, takeoffs, surveys and the PDF / drawing files stored on this server.
            Download a copy and keep it off this server — Google Drive or the office NAS. A disk wipe
            here would also wipe the copies that stay on Render.
          </p>
        </div>
        <div className="setup-template-actions">
          <button
            type="button"
            className="primary-button"
            disabled={officeBackupBusy || officeBackup?.running}
            onClick={() => void runOfficeBackupNow()}
          >
            {officeBackupBusy || officeBackup?.running ? "Backing up…" : "Backup now"}
          </button>
          {latestBackup ? (
            <a
              className="secondary-button"
              href={`/api/office-backup?download=${encodeURIComponent(latestBackup.filename)}`}
            >
              Download latest
            </a>
          ) : null}
          <span className={statusClass(backupStatus)}>
            {officeBackupBusy || officeBackup?.running
              ? "Running"
              : officeBackup?.lastOkAt
                ? `Last backup ${formatWhen(officeBackup.lastOkAt)}`
                : "No backup yet"}
          </span>
        </div>
      </div>
      {officeBackup?.lastError ? <p className="setup-inline-note">{officeBackup.lastError}</p> : null}
      <p className="setup-inline-note">
        Tender and takeoff PDFs can be up to 250MB each and are stored as files, not only inside the
        database. {officeBackup?.s3Configured
          ? "Nightly copies are also sent to your off-site S3 bucket."
          : "To send nightly copies off this server automatically, add BACKUP_S3_BUCKET and keys in Render. Until then, download this and keep it off this server."}
      </p>
      <div className="setup-readiness-grid">
        <article>
          <span>Last backup</span>
          <strong>{formatWhen(officeBackup?.lastOkAt)}</strong>
          <small>
            {latestBackup
              ? `${formatBytes(latestBackup.bytes)} · ${latestBackup.fileDirs?.length || 0} document folders · ${latestBackup.sqliteIncluded ? "database included" : "records included"}`
              : "Click Backup now, then download the file to Drive or NAS."}
          </small>
        </article>
        <article>
          <span>Off-site copy</span>
          <strong className={statusClass(officeBackup?.s3Configured ? "ready" : "warning")}>
            {officeBackup?.s3Configured ? "S3 connected" : "Download and keep off-server"}
          </strong>
          <small>
            Nightly at 02:15 UTC once NEXA_BACKUP_CRON_SECRET is set on Render. Last 14 daily copies
            are kept so the disk does not fill.
          </small>
        </article>
      </div>
      {officeBackup?.backups?.length ? (
        <div className="setup-readiness-grid" style={{ marginTop: 12 }}>
          {officeBackup.backups.slice(0, 5).map((row) => (
            <article key={row.filename}>
              <span>{formatWhen(row.createdAt)}</span>
              <strong>
                <a href={`/api/office-backup?download=${encodeURIComponent(row.filename)}`}>
                  Download {formatBytes(row.bytes)}
                </a>
              </strong>
              <small>{row.filename}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>

    <section className="setup-panel setup-readiness">
      <div className="documents-toolbar">
        <div>
          <span className="permission-heading">Company production</span>
          <h2>Ops checklist</h2>
        </div>
        <div className="setup-template-actions">
          <a className="secondary-button" href="/api/prototype-backup" download>
            Export company backup
          </a>
          <button type="button" className="secondary-button" onClick={() => void runBackupDryRun()}>
            Backup dry-run
          </button>
          <button type="button" className="secondary-button" onClick={() => void runFireDrill()}>
            Restore fire-drill
          </button>
          <button type="button" className="secondary-button" onClick={() => void runOpenAiSmoke()}>
            OpenAI smoke
          </button>
          <span className={statusClass(companyReady ? "ready" : blocked ? "blocked" : "warning")}>
            {buildLabel}
          </span>
        </div>
      </div>

      {error ? <p className="setup-inline-note">{error}</p> : null}
      {smoke ? <p className="setup-inline-note">{smoke}</p> : null}
      {backupNote ? <p className="setup-inline-note">Backup: {backupNote}</p> : null}
      {company?.note ? <p className="setup-inline-note">{company.note}</p> : null}
      <p className="setup-inline-note">
        Selling NeXa: see <a href="/early-access">/early-access</a> pack. Plumbing sales stay in Core
        leads/quotes — no second CRM required.
      </p>

      {services.length ? (
        <div className="setup-readiness-grid" style={{ marginBottom: 16 }}>
          {services.map((service) => (
            <article key={service.id}>
              <span>{service.label}{service.required ? "" : " · optional"}</span>
              <strong className={statusClass(service.status)}>{service.status}</strong>
              <small>{service.detail}</small>
            </article>
          ))}
        </div>
      ) : null}

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
          <span>Restore fire-drill</span>
          <strong
            className={statusClass(
              readiness?.fireDrill?.ok
                ? "ready"
                : backupNote.includes("Fire-drill OK")
                  ? "ready"
                  : "blocked",
            )}
          >
            {readiness?.fireDrill?.ok
              ? `${readiness.fireDrill.storesMatched}/${readiness.fireDrill.storesChecked} matched`
              : "not run"}
          </strong>
          <small>
            Shadow write/read of every backup store — live data is not overwritten. Auth passwords stay out of backups.
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
    </>
  );
}
