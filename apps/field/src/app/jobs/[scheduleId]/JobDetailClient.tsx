"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera, ClipboardCheck, Layers, MapPin, Phone } from "lucide-react";
import { ProgrammeBoard } from "@/components/ProgrammeBoard";
import { useNexaClient } from "@/lib/nexa";
import { toggleMockRequirement } from "@/lib/nexa/mock-data";
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

  function toggleRequirement(requirementId: string) {
    if (!job) return;
    try {
      setJob(toggleMockRequirement(job.scheduleId, requirementId));
    } catch {
      // Demo-only toggle.
    }
  }

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
      <main className="field-screen">
        <Link href={"/"} className="back-link">
          <ArrowLeft size={17} /> My Day
        </Link>
        <div className="feedback error">{error}</div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="field-screen">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="field-screen">
      <Link href={"/"} className="back-link">
        <ArrowLeft size={17} /> My Day
      </Link>

      <header className="field-page-header">
        <p className="eyebrow">
          {job.start}–{job.end} · {formatDuration(job.durationHours)} · {job.jobRef}
        </p>
        <h1>{job.customer}</h1>
        <p className="field-page-sub">{job.costCentre}</p>
      </header>

      <p className="job-lead">{job.description}</p>

      <div className="site-block">
        <p>{job.address}</p>
        <span>{job.contactName}</span>
        <div className="site-actions">
          <a href={mapsUrl(job.address)} target="_blank" rel="noreferrer">
            <MapPin size={16} /> Maps
          </a>
          <a href={`tel:${job.phone}`}>
            <Phone size={16} /> Call
          </a>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Job details">
        <button type="button" className={tab === "pack" ? "active" : undefined} onClick={() => setTab("pack")}>
          <Layers size={15} /> Pack
        </button>
        <button type="button" className={tab === "checklist" ? "active" : undefined} onClick={() => setTab("checklist")}>
          <ClipboardCheck size={15} /> Checklist
        </button>
        <button type="button" className={tab === "photos" ? "active" : undefined} onClick={() => setTab("photos")}>
          <Camera size={15} /> Photos
        </button>
      </div>

      {tab === "pack" ? (
        <div className="stack">
          <ProgrammeBoard jobs={jobs} activeScheduleId={job.scheduleId} />
          <div className="soft-block">
            <strong>Access</strong>
            <p>{job.accessNotes}</p>
          </div>
          {job.officeNotes.slice(0, 2).map((note) => (
            <div className="soft-block" key={note}>
              <strong>Office</strong>
              <p>{note}</p>
            </div>
          ))}
          <h2 className="stack-title">Drawings &amp; docs</h2>
          <div className="file-list">
            {(drawings.length ? drawings : job.attachments).map((file) => (
              <div className="file-row" key={file.id}>
                <span>{file.type}</span>
                <strong>{file.name}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "checklist" ? (
        <div className="stack">
          <p className="muted">Tap to mark supplied.</p>
          {job.requirements.map((item) => (
            <button
              type="button"
              className={`check-row ${item.status}`}
              key={item.id}
              disabled={item.status === "optional"}
              onClick={() => toggleRequirement(item.id)}
            >
              <span>{item.label}</span>
              <em>{item.status === "missing" ? "To do" : item.status === "done" ? "Done" : "Optional"}</em>
            </button>
          ))}
        </div>
      ) : null}

      {tab === "photos" ? (
        <div className="stack">
          {photos.length ? (
            <div className="file-list">
              {photos.map((photo) => (
                <div className="file-row" key={photo.id}>
                  <span>{photo.type}</span>
                  <strong>{photo.name}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No photos on this pack yet.</p>
          )}
        </div>
      ) : null}
    </main>
  );
}
