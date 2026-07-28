"use client";

import Link from "next/link";
import {
  Camera,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Layers,
  MapPin,
  Phone,
  Wrench,
} from "lucide-react";
import { formatDuration, mapsUrl } from "@/lib/field/format";
import { fieldPath } from "@/lib/field/routes";
import type { FieldScheduleItem } from "@/lib/field/types";

export function JobCard({ job }: { job: FieldScheduleItem }) {
  const missing = job.requirements.filter((item) => item.status === "missing").length;

  return (
    <article className="job-card">
      <Link href={fieldPath(`/jobs/${job.scheduleId}`)} className="job-card-main">
        <div className="job-time">
          <strong>{job.start}</strong>
          <span>{job.end}</span>
        </div>
        <div className="job-copy">
          <div className="job-title-row">
            <h2>{job.customer}</h2>
            <span className="status-pill">{job.status}</span>
          </div>
          <p>{job.description}</p>
          <span className="cost-centre">
            <Wrench size={14} /> {job.trade} · {job.costCentre}
          </span>
          <div className="job-chips">
            <span>{missing ? `${missing} stop/go missing` : "Stop/go ready"}</span>
            <span>{job.photos.length + job.attachments.length} pack files</span>
            <span>{formatDuration(job.durationHours)} booked</span>
          </div>
        </div>
        <ChevronRight className="job-chevron" size={22} />
      </Link>
      <div className="job-actions">
        <Link href={fieldPath(`/jobs/${job.scheduleId}?tab=pack`)}>
          <Layers size={16} /> Pack
        </Link>
        <Link href={fieldPath(`/jobs/${job.scheduleId}?tab=checklist`)}>
          <ClipboardCheck size={16} /> Checklist
        </Link>
        <Link href={fieldPath(`/jobs/${job.scheduleId}?tab=photos`)}>
          <Camera size={16} /> Photos
        </Link>
        <a href={mapsUrl(job.address)} target="_blank" rel="noreferrer">
          <MapPin size={16} /> Maps
        </a>
        <a href={`tel:${job.phone}`}>
          <Phone size={16} /> Call
        </a>
        <Link href={fieldPath("/time-check")}>
          <Clock3 size={16} /> Time
        </Link>
      </div>
      {missing > 0 ? (
        <div className="job-warning">
          {missing} required item{missing === 1 ? "" : "s"} before completion
        </div>
      ) : null}
    </article>
  );
}
