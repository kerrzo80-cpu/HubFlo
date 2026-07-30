"use client";

import type { FieldScheduleItem } from "@/lib/field/types";
import { minutesFromTime } from "@/lib/field/format";

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
      <p className="stack-title">Today&apos;s programme</p>
      <div className="programme-track">
        {jobs.map((job) => {
          const start = minutesFromTime(job.start);
          const end = minutesFromTime(job.end);
          const left = ((start - min) / (max - min)) * 100;
          const width = Math.max(8, ((end - start) / (max - min)) * 100);
          const active = job.scheduleId === activeScheduleId;
          return (
            <div
              key={job.scheduleId}
              className={active ? "programme-bar active" : "programme-bar"}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${job.start}-${job.end} ${job.customer}`}
            />
          );
        })}
      </div>
    </section>
  );
}
