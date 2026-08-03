"use client";

import { useEffect, useMemo, useState } from "react";

type AnyRecord = Record<string, unknown>;

const HEALTH_COLORS = {
  green: "#12b76a",
  amber: "#f79009",
  red: "#f04438",
} as const;

const BAR_PALETTE = ["#006eb8", "#2e8c7d", "#f79009", "#7a5af8", "#f04438", "#12b76a", "#2e90fa"];

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
        {total}
      </text>
      <text x="55" y="68" textAnchor="middle" className="nexa-kpi-donut-label">
        total
      </text>
    </svg>
  );
}

function Bars({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) {
    return <p className="nexa-kpi-empty">Nothing here yet.</p>;
  }
  return (
    <div className="nexa-kpi-bars">
      {data.slice(0, 5).map((row, index) => (
        <div className="nexa-kpi-bar-row" key={row.label}>
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
          <strong className="nexa-kpi-bar-value">{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function DashboardOverview() {
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

  const healthTotal = health.green + health.amber + health.red;

  if (!loaded && !jobs.length && !quotes.length && !leads.length) {
    return null;
  }

  return (
    <section className="nexa-kpi-grid" aria-label="Workspace overview">
      <article className="nexa-kpi-card">
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
      </article>

      <article className="nexa-kpi-card">
        <header>
          <h3>Pipeline</h3>
          <span className="nexa-kpi-sub">lead → quote → job</span>
        </header>
        <Bars data={pipeline} />
      </article>

      <article className="nexa-kpi-card">
        <header>
          <h3>Jobs by stage</h3>
          <span className="nexa-kpi-sub">{jobs.length} total</span>
        </header>
        <Bars data={jobsByStage} />
      </article>

      <article className="nexa-kpi-card">
        <header>
          <h3>Quotes by status</h3>
          <span className="nexa-kpi-sub">{quotes.length} total</span>
        </header>
        <Bars data={quotesByStatus} />
      </article>
    </section>
  );
}
