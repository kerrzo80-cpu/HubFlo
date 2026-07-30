"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera, ClipboardCheck, Layers, MapPin, Phone } from "lucide-react";
import { ProgrammeBoard } from "@/components/field/ProgrammeBoard";
import { useNexaClient } from "@/lib/field/nexa";
import { toggleMockRequirement } from "@/lib/field/nexa/mock-data";
import { formatDuration, mapsUrl } from "@/lib/field/format";
import { fieldPath } from "@/lib/field/routes";
import type { FieldEvidenceType, FieldRequirement, FieldScheduleItem } from "@/lib/field/types";

type Tab = "pack" | "checklist" | "photos";

type DraftValue = {
  text?: string;
  numberValue?: string;
  photoName?: string;
};

function evidenceTypeOf(item: FieldRequirement): FieldEvidenceType {
  return item.evidence || "Checkbox";
}

function doneSummary(item: FieldRequirement) {
  const parts = [item.value?.text, item.value?.numberValue, item.value?.photoName]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return parts.join(" · ");
}

export default function JobDetailPage() {
  const params = useParams<{ scheduleId: string }>();
  const searchParams = useSearchParams();
  const client = useNexaClient();
  const [job, setJob] = useState<FieldScheduleItem | null>(null);
  const [jobs, setJobs] = useState<FieldScheduleItem[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draftByRequirement, setDraftByRequirement] = useState<Record<string, DraftValue>>({});
  const [savingId, setSavingId] = useState("");
  const initialTab = (searchParams.get("tab") as Tab | null) ?? "pack";
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const item = await client.getJob(params.scheduleId);
        if (cancelled) return;
        if (!item) {
          setError("Job not found on the schedule.");
          return;
        }
        const schedule = await client.getScheduleForDate(item.date);
        if (cancelled) return;
        setJob(item);
        setJobs(schedule);
        setError("");

        if (client.getConnection().mode === "nexa") {
          const response = await fetch(
            `/api/field/jobs/${encodeURIComponent(item.scheduleId)}/requirements`,
          );
          if (response.ok) {
            const body = (await response.json()) as { requirements?: FieldRequirement[] };
            if (!cancelled && body.requirements?.length) {
              setJob({ ...item, requirements: body.requirements });
            }
          }
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load job.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, params.scheduleId]);

  async function saveRequirement(requirementId: string) {
    if (!job) return;
    const requirement = job.requirements.find((item) => item.id === requirementId);
    if (!requirement || requirement.status === "done") return;

    const evidenceType = evidenceTypeOf(requirement);
    const draft = draftByRequirement[requirementId] || {};
    const connection = client.getConnection();

    if (evidenceType === "Text" || evidenceType === "Signature") {
      if (!draft.text?.trim()) {
        setError(`Enter a value for “${requirement.label}” before saving.`);
        return;
      }
    }
    if (evidenceType === "Number" && !draft.numberValue?.trim()) {
      setError(`Enter a number for “${requirement.label}” before saving.`);
      return;
    }
    if (evidenceType === "Photo" && !draft.photoName?.trim()) {
      setError(`Add a photo for “${requirement.label}” before saving.`);
      return;
    }

    setError("");
    setNotice("");
    setSavingId(requirementId);

    if (connection.mode === "nexa") {
      const optimisticValue = {
        text: draft.text,
        numberValue: draft.numberValue,
        photoName: draft.photoName,
        capturedAt: new Date().toISOString(),
      };
      setJob({
        ...job,
        requirements: job.requirements.map((item) =>
          item.id === requirementId
            ? { ...item, status: "done", value: optimisticValue }
            : item,
        ),
      });
      try {
        const response = await fetch(
          `/api/field/jobs/${encodeURIComponent(job.scheduleId)}/requirements`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requirementId,
              text: draft.text,
              numberValue: draft.numberValue,
              photoName: draft.photoName,
              createdBy: job.engineerName,
            }),
          },
        );
        if (!response.ok) throw new Error("Could not save checklist item.");
        const body = (await response.json()) as { requirements?: FieldRequirement[] };
        if (body.requirements) {
          setJob((current) => (current ? { ...current, requirements: body.requirements! } : current));
        }
        setDraftByRequirement((current) => {
          const next = { ...current };
          delete next[requirementId];
          return next;
        });
        setNotice("Saved to NeXa.");
      } catch {
        setJob(job);
        setError("Could not save checklist item.");
      } finally {
        setSavingId("");
      }
      return;
    }

    try {
      setJob(toggleMockRequirement(job.scheduleId, requirementId));
      setNotice("Marked complete (demo).");
    } catch {
      // Demo-only toggle.
    } finally {
      setSavingId("");
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

  if (error && !job) {
    return (
      <main className="field-screen">
        <Link href={fieldPath("/")} className="back-link">
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
      <Link href={fieldPath("/")} className="back-link">
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

      <Link href={fieldPath(`/ask?job=${encodeURIComponent(job.scheduleId)}`)} className="field-ask-blake-link">
        Ask Blake about this job
      </Link>

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
          <p className="muted">Enter the reading, note, or photo for each item, then save. Don’t just tick Done.</p>
          {error ? <div className="feedback error">{error}</div> : null}
          {notice ? <div className="feedback">{notice}</div> : null}
          {job.requirements.map((item) => {
            const evidenceType = evidenceTypeOf(item);
            const draft = draftByRequirement[item.id] || {};
            const summary = doneSummary(item);
            return (
              <div className={`check-card ${item.status}`} key={item.id}>
                <div className="check-card-head">
                  <div>
                    <strong>{item.label}</strong>
                    <span>
                      {item.stage ? `${item.stage} · ` : ""}
                      {evidenceType}
                      {item.status === "done"
                        ? summary
                          ? ` · ${summary}`
                          : " · Saved"
                        : item.status === "optional"
                          ? " · Optional"
                          : " · Required"}
                    </span>
                  </div>
                  <em>{item.status === "missing" ? "To do" : item.status === "done" ? "Done" : "Optional"}</em>
                </div>

                {item.status === "missing" ? (
                  <div className="check-card-capture">
                    {evidenceType === "Text" || evidenceType === "Signature" ? (
                      <input
                        type="text"
                        value={draft.text || ""}
                        placeholder={evidenceType === "Signature" ? "Signed by…" : "Type the answer…"}
                        onChange={(event) =>
                          setDraftByRequirement((current) => ({
                            ...current,
                            [item.id]: { ...current[item.id], text: event.target.value },
                          }))
                        }
                      />
                    ) : null}
                    {evidenceType === "Number" ? (
                      <input
                        type="number"
                        inputMode="decimal"
                        value={draft.numberValue || ""}
                        placeholder="Enter reading…"
                        onChange={(event) =>
                          setDraftByRequirement((current) => ({
                            ...current,
                            [item.id]: { ...current[item.id], numberValue: event.target.value },
                          }))
                        }
                      />
                    ) : null}
                    {evidenceType === "Photo" ? (
                      <>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            setDraftByRequirement((current) => ({
                              ...current,
                              [item.id]: { ...current[item.id], photoName: file.name },
                            }));
                            event.target.value = "";
                          }}
                        />
                        {draft.photoName ? <small>Selected: {draft.photoName}</small> : null}
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="check-save"
                      disabled={savingId === item.id}
                      onClick={() => void saveRequirement(item.id)}
                    >
                      {evidenceType === "Checkbox" ? "Mark complete" : "Save to NeXa"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
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
