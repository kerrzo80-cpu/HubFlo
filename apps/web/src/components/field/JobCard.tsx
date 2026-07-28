"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fieldPath } from "@/lib/field/routes";
import type { FieldScheduleItem } from "@/lib/field/types";

export function JobCard({ job }: { job: FieldScheduleItem }) {
  const missing = job.requirements.filter((item) => item.status === "missing").length;

  return (
    <Link href={fieldPath(`/jobs/${job.scheduleId}`)} className="job-row">
      <div className="job-row-time">
        <strong>{job.start}</strong>
        <span>{job.end}</span>
      </div>
      <div className="job-row-copy">
        <h2>{job.customer}</h2>
        <p>
          {job.jobRef} · {job.costCentre}
        </p>
        <p className="job-row-address">{job.address}</p>
        {missing > 0 ? (
          <span className="job-row-flag">{missing} to finish</span>
        ) : (
          <span className="job-row-status">{job.status}</span>
        )}
      </div>
      <ChevronRight className="job-row-chevron" size={20} aria-hidden />
    </Link>
  );
}
