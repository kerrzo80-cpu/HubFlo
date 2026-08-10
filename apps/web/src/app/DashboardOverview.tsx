"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type AnyRecord = Record<string, unknown>;

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function num(record: AnyRecord, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function useCountUp(target: number, duration = 750): number {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [value, setValue] = useState(safeTarget);
  const fromRef = useRef(safeTarget);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      fromRef.current = safeTarget;
      setValue(safeTarget);
      return;
    }
    if (fromRef.current === safeTarget) return;
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = Math.round(from + (safeTarget - from) * eased);
      setValue(current);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = safeTarget;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [safeTarget, duration]);
  return value;
}

const HEALTH_COLORS = {
  green: "#12b76a",
  amber: "#f79009",
  red: "#f04438",
} as const;

export type JobHealthTone = keyof typeof HEALTH_COLORS;

const BAR_PALETTE = ["#006eb8", "#2e8c7d", "#f79009", "#7a5af8", "#f04438", "#12b76a", "#2e90fa"];

function str(record: AnyRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function countBy(records: AnyRecord[], key: string): Array<{ label: string; value: number }> {
  const map = new Map<string, number>();
  for (const record of records) {
    const label = str(record, key) || "Other";
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function asRecords(value: unknown): AnyRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AnyRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function parseIsoDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso?.[1]) {
    const date = new Date(`${iso[1]}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

function daysBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function Donut({ segments, total }: { segments: Array<{ value: number; color: string }>; total: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const drawable = total > 0 ? segments.filter((s) => s.value > 0) : [];
  const shown = useCountUp(total);
  return (
    <svg viewBox="0 0 110 110" className="nexa-kpi-donut" role="img" aria-label="Distribution donut">
      <circle cx="55" cy="55" r={radius} fill="none" stroke="#eef1f5" strokeWidth="14" />
      {drawable.map((segment, index) => {
        const fraction = segment.value / total;
        const dash = fraction * circumference;
        const el = (
          <circle
            key={index}
            cx="55"
            cy="55"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(dash - 3, 0)} ${circumference}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 55 55)"
          />
        );
        offset += dash;
        return el;
      })}
      <text x="55" y="52" textAnchor="middle" className="nexa-kpi-donut-value">
        {shown}
      </text>
      <text x="55" y="68" textAnchor="middle" className="nexa-kpi-donut-label">
        total
      </text>
    </svg>
  );
}

function Bars({
  data,
  money = false,
  onSelect,
}: {
  data: Array<{ label: string; value: number; key?: string }>;
  money?: boolean;
  onSelect?: (row: { label: string; value: number; key?: string }) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) {
    return <p className="nexa-kpi-empty">Nothing here yet.</p>;
  }
  return (
    <div className="nexa-kpi-bars">
      {data.slice(0, 5).map((row, index) => (
        <div
          className={`nexa-kpi-bar-row ${money ? "money" : ""}${onSelect ? " nexa-kpi-bar-row-click" : ""}`}
          key={row.key || row.label}
          role={onSelect ? "link" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onClick={
            onSelect
              ? (event) => {
                  event.stopPropagation();
                  onSelect(row);
                }
              : undefined
          }
          onKeyDown={
            onSelect
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect(row);
                  }
                }
              : undefined
          }
        >
          <span className="nexa-kpi-bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="nexa-kpi-bar-track">
            <span
              className="nexa-kpi-bar-fill"
              style={{
                width: `${(row.value / max) * 100}%`,
                background: BAR_PALETTE[index % BAR_PALETTE.length] ?? "#006eb8",
              }}
            />
          </span>
          <strong className="nexa-kpi-bar-value">{money ? gbp.format(row.value) : row.value}</strong>
        </div>
      ))}
    </div>
  );
}

type DashboardOverviewProps = {
  /** Prefer parent hub data — avoids a second jobs/quotes/leads fetch on first paint. */
  jobs?: unknown[];
  quotes?: unknown[];
  leads?: unknown[];
  loaded?: boolean;
  /** Days sent quotes stay “open” before archive trigger (default 30). */
  openQuoteWindowDays?: number;
  onOpenJobs?: () => void;
  onOpenJobHealth?: (tone: JobHealthTone) => void;
  onOpenQuotes?: () => void;
  onOpenQuoteStatus?: (status: string) => void;
  onOpenWonQuotes?: () => void;
  onOpenOpenQuotes?: () => void;
  onOpenLeads?: () => void;
  onOpenInvoices?: () => void;
  opsCards?: ReactNode;
  invoicesCard?: ReactNode;
};

export function DashboardOverview({
  jobs: jobsProp,
  quotes: quotesProp,
  leads: leadsProp,
  loaded: loadedProp,
  openQuoteWindowDays = 30,
  onOpenJobs,
  onOpenJobHealth,
  onOpenQuotes,
  onOpenQuoteStatus,
  onOpenWonQuotes,
  onOpenOpenQuotes,
  onOpenLeads,
  onOpenInvoices,
  opsCards,
  invoicesCard,
}: DashboardOverviewProps = {}) {
  const jobs = useMemo(() => asRecords(jobsProp), [jobsProp]);
  const quotes = useMemo(() => asRecords(quotesProp), [quotesProp]);
  const leads = useMemo(() => asRecords(leadsProp), [leadsProp]);
  const loaded = loadedProp ?? (jobs.length > 0 || quotes.length > 0 || leads.length > 0);
  const now = useMemo(() => new Date(), []);

  const health = useMemo(() => {
    const counts = { green: 0, amber: 0, red: 0 };
    for (const job of jobs) {
      const h = str(job, "health");
      if (h === "amber") counts.amber += 1;
      else if (h === "red") counts.red += 1;
      else counts.green += 1; // green / blue / missing → On track
    }
    return counts;
  }, [jobs]);

  const quotesByStatus = useMemo(() => countBy(quotes, "status"), [quotes]);

  const pipeline = useMemo(() => {
    return [
      { key: "leads", label: "Leads", value: leads.length },
      { key: "quotes", label: "Quotes", value: quotes.length },
      { key: "jobs", label: "Jobs", value: jobs.length },
    ];
  }, [leads, quotes, jobs]);

  const value = useMemo(() => {
    const jobsValue = jobs.reduce((sum, job) => sum + num(job, "value"), 0);
    const wonValue = quotes
      .filter((quote) => {
        if (str(quote, "status") !== "Accepted") return false;
        const when =
          parseIsoDate(str(quote, "respondedAt")) ||
          parseIsoDate(str(quote, "sentAt")) ||
          parseIsoDate(str(quote, "due"));
        if (!when) return true;
        return sameMonth(when, now);
      })
      .reduce((sum, quote) => sum + num(quote, "value"), 0);
    const openValue = quotes
      .filter((quote) => {
        const status = str(quote, "status");
        if (!["Draft", "Sent"].includes(status)) return false;
        const when =
          parseIsoDate(str(quote, "sentAt")) ||
          parseIsoDate(str(quote, "due")) ||
          parseIsoDate(str(quote, "respondedAt"));
        if (!when) return status === "Draft" || status === "Sent";
        return daysBetween(when, now) <= openQuoteWindowDays;
      })
      .reduce((sum, quote) => sum + num(quote, "value"), 0);
    return { jobsValue, wonValue, openValue };
  }, [jobs, now, openQuoteWindowDays, quotes]);

  const healthTotal = health.green + health.amber + health.red;
  const shownJobsValue = useCountUp(value.jobsValue);

  const openHealth = (tone: JobHealthTone) => {
    onOpenJobHealth?.(tone);
    if (!onOpenJobHealth) onOpenJobs?.();
  };

  const Card = ({
    children,
    onClick,
    label,
  }: {
    children: ReactNode;
    onClick?: () => void;
    label: string;
  }) =>
    onClick ? (
      <button className="nexa-kpi-card nexa-kpi-card-button nexa-kpi-card-fixed" type="button" onClick={onClick} aria-label={label}>
        {children}
      </button>
    ) : (
      <article className="nexa-kpi-card nexa-kpi-card-fixed">{children}</article>
    );

  return (
    <section className="nexa-kpi-grid nexa-kpi-grid-aligned" aria-label="Workspace overview">
      <article className="nexa-kpi-card nexa-kpi-card-fixed" aria-label="Job health">
        <header>
          <h3>Job health</h3>
          <span className="nexa-kpi-sub">{loaded ? `${healthTotal} live` : "…"}</span>
        </header>
        <div className="nexa-kpi-card-scroll">
          <div className="nexa-kpi-donut-wrap">
            <button
              type="button"
              className="nexa-kpi-donut-hit"
              onClick={() => onOpenJobs?.()}
              aria-label="Open all live jobs"
            >
              <Donut
                total={healthTotal}
                segments={[
                  { value: health.green, color: HEALTH_COLORS.green },
                  { value: health.amber, color: HEALTH_COLORS.amber },
                  { value: health.red, color: HEALTH_COLORS.red },
                ]}
              />
            </button>
            <ul className="nexa-kpi-legend">
              <li>
                <button type="button" className="nexa-kpi-legend-btn" onClick={() => openHealth("green")}>
                  <span style={{ background: HEALTH_COLORS.green }} /> On track <strong>{health.green}</strong>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="nexa-kpi-legend-btn"
                  title="Approval required — office needs to approve something on the job"
                  onClick={() => openHealth("amber")}
                >
                  <span style={{ background: HEALTH_COLORS.amber }} /> Attention <strong>{health.amber}</strong>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="nexa-kpi-legend-btn"
                  title="Waiting on parts or waiting on customer"
                  onClick={() => openHealth("red")}
                >
                  <span style={{ background: HEALTH_COLORS.red }} /> Blocked <strong>{health.red}</strong>
                </button>
              </li>
            </ul>
            <p className="nexa-kpi-card-hint">
              Attention = approval required · Blocked = waiting on parts / customer
            </p>
          </div>
        </div>
      </article>

      {opsCards}

      <article className="nexa-kpi-card nexa-kpi-card-fixed" aria-label="Pipeline">
        <header>
          <h3>Pipeline</h3>
          <span className="nexa-kpi-sub">lead → quote → job</span>
        </header>
        <div className="nexa-kpi-card-scroll">
          <Bars
            data={pipeline}
            onSelect={(row) => {
              if (row.key === "leads") onOpenLeads?.();
              else if (row.key === "quotes") onOpenQuotes?.();
              else if (row.key === "jobs") onOpenJobs?.();
            }}
          />
        </div>
      </article>

      <article className="nexa-kpi-card nexa-kpi-card-fixed" aria-label="Quotes by status">
        <header>
          <h3>Quotes by status</h3>
          <span className="nexa-kpi-sub">{quotes.length} total</span>
        </header>
        <div className="nexa-kpi-card-scroll">
          <Bars
            data={quotesByStatus.map((row) => ({ ...row, key: row.label }))}
            onSelect={(row) => {
              const status = row.key || row.label;
              if (onOpenQuoteStatus) onOpenQuoteStatus(status);
              else onOpenQuotes?.();
            }}
          />
        </div>
      </article>

      {invoicesCard ?? (
        <Card onClick={onOpenInvoices} label="Open invoices">
          <header>
            <h3>Invoices</h3>
            <span className="nexa-kpi-sub">ops</span>
          </header>
          <div className="nexa-kpi-card-scroll">
            <p className="nexa-kpi-empty">Open invoices</p>
          </div>
        </Card>
      )}

      <Card onClick={onOpenQuotes} label="Open live value">
        <header>
          <h3>Live value</h3>
          <span className="nexa-kpi-sub">workspace</span>
        </header>
        <div className="nexa-kpi-card-scroll">
          <div className="nexa-kpi-metric">
            <strong>{gbp.format(shownJobsValue)}</strong>
            <span>across {jobs.length} jobs</span>
          </div>
          <Bars
            money
            onSelect={(row) => {
              if (row.key === "won") (onOpenWonQuotes || onOpenQuotes)?.();
              else if (row.key === "open") (onOpenOpenQuotes || onOpenQuotes)?.();
            }}
            data={[
              { key: "won", label: "Won this month", value: value.wonValue },
              { key: "open", label: `Open (last ${openQuoteWindowDays}d)`, value: value.openValue },
            ]}
          />
        </div>
      </Card>
    </section>
  );
}
