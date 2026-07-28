"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock3, FileText } from "lucide-react";
import { JobCard } from "@/components/JobCard";
import { useNexaClient } from "@/lib/nexa";
import { formatDuration, todayLabel } from "@/lib/format";
import type { FieldScheduleItem } from "@/lib/types";

export default function MyDayPage() {
  const client = useNexaClient();
  const [jobs, setJobs] = useState<FieldScheduleItem[]>([]);
  const [engineerName, setEngineerName] = useState("Field engineer");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [schedule, engineer] = await Promise.all([
          client.getTodaySchedule(),
          client.getEngineer(),
        ]);
        if (cancelled) return;
        setJobs(schedule);
        setEngineerName(engineer.name);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load schedule.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const totalHours = jobs.reduce((sum, job) => sum + job.durationHours, 0);
  const missing = jobs.reduce(
    (sum, job) => sum + job.requirements.filter((item) => item.status === "missing").length,
    0,
  );
  const packFiles = jobs.reduce((sum, job) => sum + job.attachments.length + job.photos.length, 0);
  const firstJob = jobs[0];
  const connection = client.getConnection();

  return (
    <main className="field-content">
      <section className="hero">
        <p className="eyebrow">NeXa Field · {engineerName}</p>
        <h1>My jobs today</h1>
        <p>
          Demo day for {engineerName}: boiler service, reactive leak, bathroom first fix, cylinder swap, joinery and a
          callback. Open packs, tick stop/go, then let Blake walk your time check.
        </p>
        <div className="summary-grid">
          <div>
            <strong>{jobs.length}</strong>
            <span>Jobs</span>
          </div>
          <div>
            <strong>{formatDuration(totalHours)}</strong>
            <span>Booked</span>
          </div>
          <div>
            <strong>{missing}</strong>
            <span>Required</span>
          </div>
          <div>
            <strong>{packFiles}</strong>
            <span>Pack files</span>
          </div>
        </div>
      </section>

      <section className="action-strip" aria-label="Daily actions">
        <Link href={firstJob ? `/jobs/${firstJob.scheduleId}` : "/time-check"}>
          <FileText size={17} /> Open next job
        </Link>
        <Link href="/time-check">
          <Clock3 size={17} /> Blake time check
        </Link>
      </section>

      {error ? <div className="feedback error">{error}</div> : null}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h2>{jobs[0] ? todayLabel(jobs[0].date) : "Today"}</h2>
          </div>
          <CalendarDays size={22} />
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {connection.label}
        </p>
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {jobs.map((job) => (
            <JobCard key={job.scheduleId} job={job} />
          ))}
          {!jobs.length && !error ? <p className="muted">No jobs booked for today.</p> : null}
        </div>
      </section>
    </main>
  );
}
