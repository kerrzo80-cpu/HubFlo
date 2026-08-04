"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DayPicker } from "@/components/field/DayPicker";
import { JobCard } from "@/components/field/JobCard";
import { useNexaClient } from "@/lib/field/nexa";
import { formatDuration, isoDate, todayLabel } from "@/lib/field/format";
import { fieldPath } from "@/lib/field/routes";
import type { FieldScheduleItem } from "@/lib/field/types";

type FieldAlert = {
  id: string;
  kind: string;
  scheduleId: string;
  jobRef: string;
  title: string;
  detail: string;
  status: string;
};

const SEEN_ALERTS_KEY = "ewg-field-po-alerts-seen";

function readSeenAlertIds() {
  try {
    const raw = window.localStorage.getItem(SEEN_ALERTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

function writeSeenAlertIds(ids: string[]) {
  try {
    window.localStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify(ids.slice(0, 40)));
  } catch {
    // Ignore storage failures on private mode.
  }
}

export default function MyDayPage() {
  const client = useNexaClient();
  const [selectedDate, setSelectedDate] = useState(isoDate);
  const [jobs, setJobs] = useState<FieldScheduleItem[]>([]);
  const [datesWithJobs, setDatesWithJobs] = useState<string[]>([]);
  const [engineerName, setEngineerName] = useState("Field engineer");
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState<FieldAlert[]>([]);

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

  useEffect(() => {
    let cancelled = false;
    async function loadAlerts() {
      try {
        const response = await fetch(
          `/api/field/alerts?date=${encodeURIComponent(selectedDate)}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { alerts?: FieldAlert[] };
        const next = Array.isArray(body.alerts) ? body.alerts : [];
        if (cancelled) return;
        setAlerts(next);

        const seen = readSeenAlertIds();
        const fresh = next.filter((alert) => !seen.has(alert.id));
        if (!fresh.length || typeof window === "undefined" || !("Notification" in window)) return;

        const notify = async () => {
          if (Notification.permission === "default") {
            await Notification.requestPermission();
          }
          if (Notification.permission !== "granted") return;
          for (const alert of fresh.slice(0, 3)) {
            new Notification(alert.title, {
              body: alert.detail,
              tag: alert.id,
            });
          }
          writeSeenAlertIds([...seen, ...fresh.map((alert) => alert.id)]);
        };
        void notify();
      } catch {
        // Alerts are best-effort.
      }
    }
    void loadAlerts();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

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

      {alerts.length ? (
        <section className="field-alert-list" aria-label="Office updates">
          {alerts.map((alert) => (
            <Link
              key={alert.id}
              href={
                alert.scheduleId
                  ? fieldPath(`/jobs/${encodeURIComponent(alert.scheduleId)}?tab=po`)
                  : fieldPath("/")
              }
              className={`field-alert-card is-${alert.status === "Approved" ? "good" : alert.status === "Rejected" ? "bad" : "info"}`}
            >
              <span>{alert.title}</span>
              <strong>{alert.detail}</strong>
              <small>Open POs tab</small>
            </Link>
          ))}
        </section>
      ) : null}

      {firstJob && isToday ? (
        <Link href={fieldPath(`/jobs/${firstJob.scheduleId}`)} className="field-next-job">
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
