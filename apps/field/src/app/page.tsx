"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DayPicker } from "@/components/DayPicker";
import { JobCard } from "@/components/JobCard";
import { useNexaClient } from "@/lib/nexa";
import { formatDuration, isoDate, todayLabel } from "@/lib/format";
import type { FieldScheduleItem } from "@/lib/types";

export default function MyDayPage() {
  const client = useNexaClient();
  const [selectedDate, setSelectedDate] = useState(isoDate);
  const [jobs, setJobs] = useState<FieldScheduleItem[]>([]);
  const [datesWithJobs, setDatesWithJobs] = useState<string[]>([]);
  const [engineerName, setEngineerName] = useState("Field engineer");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadMeta() {
      try {
        const [engineer, dates] = await Promise.all([client.getEngineer(), client.getScheduleDates()]);
        if (cancelled) return;
        setEngineerName(engineer.name);
        setDatesWithJobs(dates);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load schedule.");
      }
    }
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    async function loadDay() {
      try {
        const schedule = await client.getScheduleForDate(selectedDate);
        if (cancelled) return;
        setJobs(schedule);
        setError("");
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load schedule.");
      }
    }
    void loadDay();
    return () => {
      cancelled = true;
    };
  }, [client, selectedDate]);

  const totalHours = jobs.reduce((sum, job) => sum + job.durationHours, 0);
  const firstJob = jobs[0];
  const isToday = selectedDate === isoDate();

  return (
    <main className="field-screen">
      <header className="field-page-header">
        <p className="eyebrow">{engineerName}</p>
        <h1>{todayLabel(selectedDate)}</h1>
        <p className="field-page-sub">
          {jobs.length
            ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} · ${formatDuration(totalHours)} booked`
            : "No jobs booked"}
        </p>
      </header>

      <DayPicker
        selectedDate={selectedDate}
        datesWithJobs={datesWithJobs}
        onSelectDate={setSelectedDate}
      />

      {firstJob && isToday ? (
        <Link href={`/jobs/${firstJob.scheduleId}`} className="field-next-job">
          <span>Next up</span>
          <strong>
            {firstJob.start} · {firstJob.customer}
          </strong>
        </Link>
      ) : null}

      {error ? <div className="feedback error">{error}</div> : null}

      <section className="job-list" aria-label={`Jobs for ${todayLabel(selectedDate)}`}>
        {jobs.map((job) => (
          <JobCard key={job.scheduleId} job={job} />
        ))}
        {!jobs.length && !error ? (
          <p className="muted field-empty-day">Nothing booked for this day.</p>
        ) : null}
      </section>
    </main>
  );
}
