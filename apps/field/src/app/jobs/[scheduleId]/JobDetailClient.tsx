"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  ClipboardCheck,
  Layers,
  MapPin,
  Phone,
} from "lucide-react";
import { ProgrammeBoard } from "@/components/ProgrammeBoard";
import { useNexaClient } from "@/lib/nexa";
import { formatDuration, mapsUrl } from "@/lib/format";
import type { FieldScheduleItem } from "@/lib/types";

type Tab = "pack" | "checklist" | "photos";

export default function JobDetailPage() {
  const params = useParams<{ scheduleId: string }>();
  const searchParams = useSearchParams();
  const client = useNexaClient();
  const [job, setJob] = useState<FieldScheduleItem | null>(null);
  const [jobs, setJobs] = useState<FieldScheduleItem[]>([]);
  const [error, setError] = useState("");
  const initialTab = (searchParams.get("tab") as Tab | null) ?? "pack";
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [item, schedule] = await Promise.all([
          client.getJob(params.scheduleId),
          client.getTodaySchedule(),
        ]);
        if (cancelled) return;
        if (!item) {
          setError("Job not found on today's schedule.");
          return;
        }
        setJob(item);
        setJobs(schedule);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load job.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, params.scheduleId]);

  const drawings = useMemo(
    () => job?.attachments.filter((item) => item.type === "Drawing" || item.type === "PDF") ?? [],
    [job],
  );
  const photos = useMemo(
    () => [...(job?.photos ?? []), ...(job?.attachments.filter((item) => item.type === "Photo") ?? [])],
    [job],
  );

  if (error) {
    return (
      <main className="field-content">
        <Link href="/" className="back-link">
          <ArrowLeft size={17} /> Back to My Day
        </Link>
        <div className="feedback error">{error}</div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="field-content">
        <p className="muted">Loading job pack…</p>
      </main>
    );
  }

  return (
    <main className="field-content">
      <Link href="/" className="back-link">
        <ArrowLeft size={17} /> Back to My Day
      </Link>

      <section className="hero">
        <p className="eyebrow">
          {job.jobRef} · {job.trade} · {job.costCentre}
        </p>
        <h1>{job.customer}</h1>
        <p>{job.description}</p>
        <div className="meta-row">
          <span>
            {job.start}-{job.end}
          </span>
          <span>{formatDuration(job.durationHours)} booked</span>
          <span>{job.status}</span>
          <span>{drawings.length + photos.length} pack files</span>
        </div>
      </section>

      <section className="contact-card">
        <p className="eyebrow">Site</p>
        <h2>{job.address}</h2>
        <p className="muted">Contact: {job.contactName}</p>
        <div className="contact-actions">
          <a href={mapsUrl(job.address)} target="_blank" rel="noreferrer">
            <MapPin size={17} /> Maps
          </a>
          <a href={`tel:${job.phone}`}>
            <Phone size={17} /> Call
          </a>
        </div>
      </section>

      <section className="panel">
        <div className="tabs" role="tablist" aria-label="Job pack">
          <button type="button" className={tab === "pack" ? "active" : undefined} onClick={() => setTab("pack")}>
            <Layers size={16} /> Pack
          </button>
          <button type="button" className={tab === "checklist" ? "active" : undefined} onClick={() => setTab("checklist")}>
            <ClipboardCheck size={16} /> Checklist
          </button>
          <button type="button" className={tab === "photos" ? "active" : undefined} onClick={() => setTab("photos")}>
            <Camera size={16} /> Photos
          </button>
        </div>

        {tab === "pack" ? (
          <div className="pack-grid">
            <ProgrammeBoard jobs={jobs} activeScheduleId={job.scheduleId} />
            <div className="note-block">
              <strong>Access</strong>
              <p>{job.accessNotes}</p>
            </div>
            {job.officeNotes.map((note) => (
              <div className="note-block" key={note}>
                <strong>Office note</strong>
                <p>{note}</p>
              </div>
            ))}
            <div className="section-heading">
              <div>
                <p className="eyebrow">Drawings &amp; docs</p>
                <h2>Office attachments</h2>
              </div>
            </div>
            <div className="file-grid">
              {(drawings.length ? drawings : job.attachments).map((file) => (
                <div className="file-tile" key={file.id}>
                  <span className="eyebrow">{file.type}</span>
                  <strong>{file.name}</strong>
                  <small>
                    {file.uploadedBy} · {file.uploadedAt}
                  </small>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "checklist" ? (
          <div className="checklist">
            <p className="muted">Stop / go items for this cost centre. Missing items block completion.</p>
            {job.requirements.map((item) => (
              <div className={`checklist-item ${item.status}`} key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {item.status === "missing"
                      ? "Required before completion"
                      : item.status === "done"
                        ? "Evidence supplied"
                        : "Optional"}
                  </span>
                </div>
                <em>{item.status === "missing" ? "Missing" : item.status === "done" ? "Done" : "Optional"}</em>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "photos" ? (
          <div className="file-grid">
            {photos.map((photo) => (
              <div className="file-tile" key={photo.id}>
                <span className="eyebrow">{photo.type}</span>
                <strong>{photo.name}</strong>
                <small>
                  {photo.uploadedBy} · {photo.uploadedAt}
                </small>
              </div>
            ))}
            {!photos.length ? <p className="muted">No photos on this pack yet.</p> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
