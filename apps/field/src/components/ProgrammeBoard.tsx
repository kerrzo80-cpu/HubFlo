"use client";

import type { FieldScheduleItem } from "@/lib/types";
import { formatDuration, minutesFromTime } from "@/lib/format";

export function ProgrammeBoard({
  jobs,
  activeScheduleId,
}: {
  jobs: FieldScheduleItem[];
  activeScheduleId?: string;
}) {
  if (!jobs.length) return null;
  const starts = jobs.map((job) => minutesFromTime(job.start));
  const ends = jobs.map((job) => minutesFromTime(job.end));
  const min = Math.min(...starts, 8 * 60);
  const max = Math.max(...ends, min + 60);

  return (
    <section className="programme-board" aria-label="Today programme">
      <div className="programme-legend">
        <strong>Today&apos;s programme</strong>
        <span>
          {String(Math.floor(min / 60)).padStart(2, "0")}:{String(min % 60).padStart(2, "0")}
          {" – "}
          {String(Math.floor(max / 60)).padStart(2, "0")}:{String(max % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="programme-track">
        {jobs.map((job) => {
          const start = minutesFromTime(job.start);
          const end = minutesFromTime(job.end);
          const left = ((start - min) / (max - min)) * 100;
          const width = Math.max(10, ((end - start) / (max - min)) * 100);
          const active = job.scheduleId === activeScheduleId;
          return (
            <div
              key={job.scheduleId}
              className={active ? "programme-bar active" : "programme-bar"}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${job.start}-${job.end} ${job.customer}`}
            >
              <strong>{job.start}</strong>
              <span>{job.customer}</span>
            </div>
          );
        })}
      </div>
      <ul className="programme-list">
        {jobs.map((job) => (
          <li key={job.scheduleId}>
            <strong>
              {job.start}-{job.end}
            </strong>
            <span>
              {job.jobRef} · {job.customer} · {formatDuration(job.durationHours)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
