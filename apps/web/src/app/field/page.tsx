"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { JobCard } from "@/components/field/JobCard";
import { useNexaClient } from "@/lib/field/nexa";
import { formatDuration, todayLabel } from "@/lib/field/format";
import { fieldPath } from "@/lib/field/routes";
import type { FieldScheduleItem } from "@/lib/field/types";

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
  const firstJob = jobs[0];

  return (
    <main className="field-screen">
      <header className="field-page-header">
        <p className="eyebrow">{engineerName}</p>
        <h1>{jobs[0] ? todayLabel(jobs[0].date) : "Today"}</h1>
        <p className="field-page-sub">
          {jobs.length} jobs · {formatDuration(totalHours)} booked
        </p>
      </header>

      {firstJob ? (
        <Link href={fieldPath(`/jobs/${firstJob.scheduleId}`)} className="field-next-job">
          <span>Next up</span>
          <strong>
            {firstJob.start} · {firstJob.customer}
          </strong>
        </Link>
      ) : null}

      {error ? <div className="feedback error">{error}</div> : null}

      <section className="job-list" aria-label="Today's jobs">
        {jobs.map((job) => (
          <JobCard key={job.scheduleId} job={job} />
        ))}
        {!jobs.length && !error ? <p className="muted">No jobs booked for today.</p> : null}
      </section>
    </main>
  );
}
