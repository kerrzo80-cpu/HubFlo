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
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = Math.round(from + (target - from) * eased);
      setValue(current);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

const HEALTH_COLORS = {
  green: "#12b76a",
  amber: "#f79009",
  red: "#f04438",
} as const;

const BAR_PALETTE = ["#006eb8", "#2e8c7d", "#f79009", "#7a5af8", "#f04438", "#12b76a", "#2e90fa"];

const DONE_STATUSES = new Set(["Ready to invoice", "Invoiced", "Completed", "Complete"]);

function asArray(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? (value as AnyRecord[]) : [];
}

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

function Ring({ percent, centerLabel, sub }: { percent: number; centerLabel: string; sub: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const shown = useCountUp(Math.round(percent));
  const dash = (Math.max(0, Math.min(100, shown)) / 100) * circumference;
  return (
    <div className="nexa-kpi-ring-wrap">
      <svg viewBox="0 0 110 110" className="nexa-kpi-donut" role="img" aria-label="Progress ring">
        <defs>
          <linearGradient id="nexaRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#006eb8" />
            <stop offset="100%" stopColor="#2e8c7d" />
          </linearGradient>
        </defs>
        <circle cx="55" cy="55" r={radius} fill="none" stroke="#eef1f5" strokeWidth="14" />
        <circle
          cx="55"
          cy="55"
          r={radius}
          fill="none"
          stroke="url(#nexaRingGrad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform="rotate(-90 55 55)"
        />
        <text x="55" y="52" textAnchor="middle" className="nexa-kpi-donut-value">
          {centerLabel}
        </text>
        <text x="55" y="68" textAnchor="middle" className="nexa-kpi-donut-label">
          done
        </text>
      </svg>
      <p className="nexa-kpi-ring-sub">{sub}</p>
    </div>
  );
}

function Bars({ data, money = false }: { data: Array<{ label: string; value: number }>; money?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) {
    return <p className="nexa-kpi-empty">Nothing here yet.</p>;
  }
  return (
    <div className="nexa-kpi-bars">
      {data.slice(0, 5).map((row, index) => (
        <div className={`nexa-kpi-bar-row ${money ? "money" : ""}`} key={row.label}>
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
  onOpenJobs?: () => void;
  onOpenQuotes?: () => void;
  onOpenLeads?: () => void;
};

export function DashboardOverview({ onOpenJobs, onOpenQuotes, onOpenLeads }: DashboardOverviewProps = {}) {
  const [jobs, setJobs] = useState<AnyRecord[]>([]);
  const [quotes, setQuotes] = useState<AnyRecord[]>([]);
  const [leads, setLeads] = useState<AnyRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const endpoints: Array<[string, (v: AnyRecord[]) => void]> = [
        ["/api/jobs", setJobs],
        ["/api/quotes", setQuotes],
        ["/api/leads", setLeads],
      ];
      await Promise.all(
        endpoints.map(async ([url, setter]) => {
          try {
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            if (active) setter(asArray(data));
          } catch {
            /* leave empty on failure */
          }
        }),
      );
      if (active) setLoaded(true);
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const health = useMemo(() => {
    const counts = { green: 0, amber: 0, red: 0 };
    for (const job of jobs) {
      const h = str(job, "health");
      if (h === "green" || h === "amber" || h === "red") counts[h] += 1;
      else counts.green += 1;
    }
    return counts;
  }, [jobs]);

  const jobsByStage = useMemo(() => countBy(jobs, "status"), [jobs]);
  const quotesByStatus = useMemo(() => countBy(quotes, "status"), [quotes]);

  const pipeline = useMemo(() => {
    const rows = [
      { label: "Leads", value: leads.length },
      { label: "Quotes", value: quotes.length },
      { label: "Jobs", value: jobs.length },
    ];
    return rows;
  }, [leads, quotes, jobs]);

  const workload = useMemo(() => countBy(jobs, "manager"), [jobs]);

  const value = useMemo(() => {
    const jobsValue = jobs.reduce((sum, job) => sum + num(job, "value"), 0);
    const wonValue = quotes
      .filter((quote) => str(quote, "status") === "Accepted")
      .reduce((sum, quote) => sum + num(quote, "value"), 0);
    const openValue = quotes
      .filter((quote) => !["Accepted", "Declined"].includes(str(quote, "status")))
      .reduce((sum, quote) => sum + num(quote, "value"), 0);
    return { jobsValue, wonValue, openValue };
  }, [jobs, quotes]);

  const progress = useMemo(() => {
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(now.getDate() - mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const within = jobs.filter((job) => {
      const raw = str(job, "scheduledDate");
      if (!raw) return false;
      const time = new Date(raw).getTime();
      return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
    });

    if (within.length > 0) {
      const done = within.filter((job) => DONE_STATUSES.has(str(job, "status"))).length;
      return {
        title: "This week",
        badge: `${within.length} booked`,
        percent: Math.round((done / within.length) * 100),
        sub: `${done}/${within.length} jobs done`,
      };
    }

    const done = jobs.filter((job) => DONE_STATUSES.has(str(job, "status"))).length;
    return {
      title: "Completion",
      badge: "all jobs",
      percent: jobs.length ? Math.round((done / jobs.length) * 100) : 0,
      sub: jobs.length ? `${done}/${jobs.length} jobs done` : "No jobs yet",
    };
  }, [jobs]);

  const healthTotal = health.green + health.amber + health.red;
  const shownJobsValue = useCountUp(value.jobsValue);

  if (!loaded && !jobs.length && !quotes.length && !leads.length) {
    return null;
  }

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
      <button className="nexa-kpi-card nexa-kpi-card-button" type="button" onClick={onClick} aria-label={label}>
        {children}
      </button>
    ) : (
      <article className="nexa-kpi-card">{children}</article>
    );

  return (
    <section className="nexa-kpi-grid" aria-label="Workspace overview">
      <Card onClick={onOpenJobs} label="Open jobs">
        <header>
          <h3>Job health</h3>
          <span className="nexa-kpi-sub">{healthTotal} live</span>
        </header>
        <div className="nexa-kpi-donut-wrap">
          <Donut
            total={healthTotal}
            segments={[
              { value: health.green, color: HEALTH_COLORS.green },
              { value: health.amber, color: HEALTH_COLORS.amber },
              { value: health.red, color: HEALTH_COLORS.red },
            ]}
          />
          <ul className="nexa-kpi-legend">
            <li>
              <span style={{ background: HEALTH_COLORS.green }} /> On track <strong>{health.green}</strong>
            </li>
            <li>
              <span style={{ background: HEALTH_COLORS.amber }} /> Attention <strong>{health.amber}</strong>
            </li>
            <li>
              <span style={{ background: HEALTH_COLORS.red }} /> Blocked <strong>{health.red}</strong>
            </li>
          </ul>
        </div>
      </Card>

      <Card onClick={onOpenJobs} label="Open jobs this week">
        <header>
          <h3>{progress.title}</h3>
          <span className="nexa-kpi-sub">{progress.badge}</span>
        </header>
        <Ring percent={progress.percent} centerLabel={`${progress.percent}%`} sub={progress.sub} />
      </Card>

      <Card
        onClick={() => {
          if (leads.length && onOpenLeads) onOpenLeads();
          else if (onOpenQuotes) onOpenQuotes();
          else onOpenJobs?.();
        }}
        label="Open pipeline"
      >
        <header>
          <h3>Pipeline</h3>
          <span className="nexa-kpi-sub">lead → quote → job</span>
        </header>
        <Bars data={pipeline} />
      </Card>

      <Card onClick={onOpenJobs} label="Open jobs by stage">
        <header>
          <h3>Jobs by stage</h3>
          <span className="nexa-kpi-sub">{jobs.length} total</span>
        </header>
        <Bars data={jobsByStage} />
      </Card>

      <Card onClick={onOpenQuotes} label="Open quotes">
        <header>
          <h3>Quotes by status</h3>
          <span className="nexa-kpi-sub">{quotes.length} total</span>
        </header>
        <Bars data={quotesByStatus} />
      </Card>

      <Card onClick={onOpenJobs} label="Open workload">
        <header>
          <h3>Workload</h3>
          <span className="nexa-kpi-sub">jobs per owner</span>
        </header>
        <Bars data={workload} />
      </Card>

      <Card onClick={onOpenQuotes} label="Open live value">
        <header>
          <h3>Live value</h3>
          <span className="nexa-kpi-sub">workspace</span>
        </header>
        <div className="nexa-kpi-metric">
          <strong>{gbp.format(shownJobsValue)}</strong>
          <span>across {jobs.length} jobs</span>
        </div>
        <Bars
          money
          data={[
            { label: "Won quotes", value: value.wonValue },
            { label: "Open quotes", value: value.openValue },
          ]}
        />
      </Card>
    </section>
  );
}
