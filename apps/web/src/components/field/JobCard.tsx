"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fieldPath } from "@/lib/field/routes";
import type { FieldScheduleItem } from "@/lib/field/types";

export function JobCard({ job }: { job: FieldScheduleItem }) {
  return (
    <Link href={fieldPath(`/jobs/${job.scheduleId}`)} className="field-job-row">
      <div className="field-job-time">
        <strong>{job.start}</strong>
        <span>{job.end}</span>
      </div>
      <div className="field-job-copy">
        <strong className="field-job-name">{job.customer}</strong>
        <span className="field-job-address">{job.address}</span>
      </div>
      <ChevronRight className="field-job-chevron" size={18} aria-hidden />
    </Link>
  );
}
