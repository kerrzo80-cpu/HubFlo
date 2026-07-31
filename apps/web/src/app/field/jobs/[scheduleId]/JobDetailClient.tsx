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

function validateRequirementDraft(item: FieldRequirement, draft: DraftValue): string | null {
  const evidenceType = evidenceTypeOf(item);
  if (evidenceType === "Checkbox") return null;

  const raw =
    evidenceType === "Number"
      ? draft.numberValue?.trim() || ""
      : evidenceType === "Photo"
        ? draft.photoName?.trim() || ""
        : draft.text?.trim() || "";

  if (!raw) {
    if (evidenceType === "Photo") return `Add a photo for “${item.label}” before saving.`;
    if (evidenceType === "Number") return `Enter a number for “${item.label}” before saving.`;
    return `Enter a value for “${item.label}” before saving.`;
  }

  const validation = item.validation;
  if (!validation) return null;

  const compact = raw.replace(/\s+/g, "");
  if (typeof validation.exactDigits === "number") {
    const digits = compact.replace(/\D/g, "");
    if (digits.length !== validation.exactDigits || digits.length !== compact.length) {
      return `“${item.label}” must be exactly ${validation.exactDigits} digits (you entered ${digits.length || 0}).`;
    }
  }
  if (typeof validation.minLength === "number" && compact.length < validation.minLength) {
    return `“${item.label}” must be at least ${validation.minLength} characters.`;
  }
  if (typeof validation.maxLength === "number" && compact.length > validation.maxLength) {
    return `“${item.label}” must be no more than ${validation.maxLength} characters.`;
  }
  if (validation.pattern) {
    try {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(raw) && !regex.test(compact)) {
        return validation.helpText
          ? `“${item.label}” is not valid. ${validation.helpText}`
          : `“${item.label}” is not in the required format.`;
      }
    } catch {
      // Ignore bad patterns.
    }
  }
  return null;
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
  const [editingId, setEditingId] = useState("");
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

  function beginEdit(item: FieldRequirement) {
    setEditingId(item.id);
    setDraftByRequirement((current) => ({
      ...current,
      [item.id]: {
        text: item.value?.text || "",
        numberValue: item.value?.numberValue || "",
        photoName: item.value?.photoName || "",
      },
    }));
    setError("");
    setNotice("");
  }

  async function reopenRequirement(requirementId: string) {
    if (!job) return;
    const requirement = job.requirements.find((item) => item.id === requirementId);
    if (!requirement) return;
    const connection = client.getConnection();
    setSavingId(requirementId);
    setError("");
    setNotice("");

    if (connection.mode === "nexa") {
      try {
        const response = await fetch(
          `/api/field/jobs/${encodeURIComponent(job.scheduleId)}/requirements`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requirementId,
              reopen: true,
              createdBy: job.engineerName,
            }),
          },
        );
        if (!response.ok) throw new Error("Could not reopen checklist item.");
        const body = (await response.json()) as { requirements?: FieldRequirement[] };
        if (body.requirements) {
          setJob((current) => (current ? { ...current, requirements: body.requirements! } : current));
        }
        beginEdit({ ...requirement, status: "missing", value: undefined });
        setNotice("Item reopened — amend and save.");
      } catch {
        setError("Could not reopen checklist item.");
      } finally {
        setSavingId("");
      }
      return;
    }

    beginEdit(requirement);
    setJob({
      ...job,
      requirements: job.requirements.map((item) =>
        item.id === requirementId ? { ...item, status: "missing" } : item,
      ),
    });
    setSavingId("");
  }

  async function saveRequirement(requirementId: string) {
    if (!job) return;
    const requirement = job.requirements.find((item) => item.id === requirementId);
    if (!requirement) return;

    const evidenceType = evidenceTypeOf(requirement);
    const draft = draftByRequirement[requirementId] || {};
    const connection = client.getConnection();
    const validationError = validateRequirementDraft(requirement, draft);
    if (validationError) {
      setError(validationError);
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
        if (!response.ok) {
          const failed = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(failed.error || "Could not save checklist item.");
        }
        const body = (await response.json()) as { requirements?: FieldRequirement[] };
        if (body.requirements) {
          setJob((current) => (current ? { ...current, requirements: body.requirements! } : current));
        }
        setDraftByRequirement((current) => {
          const next = { ...current };
          delete next[requirementId];
          return next;
        });
        setEditingId("");
        setNotice("Saved.");
      } catch (saveError) {
        setJob(job);
        setError(saveError instanceof Error ? saveError.message : "Could not save checklist item.");
      } finally {
        setSavingId("");
      }
      return;
    }

    try {
      setJob(toggleMockRequirement(job.scheduleId, requirementId));
      setEditingId("");
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
        <div className="stack checklist-stack">
          <p className="checklist-intro muted">
            Questions match the Landlord Gas Safety Record. Values must be complete and valid before Save — e.g. a 12-digit Gas Safe ID will not save with only 11.
          </p>
          {error ? <div className="feedback error">{error}</div> : null}
          {notice ? <div className="feedback">{notice}</div> : null}
          {job.requirements.map((item) => {
            const evidenceType = evidenceTypeOf(item);
            const draft = draftByRequirement[item.id] || {};
            const summary = doneSummary(item);
            const isEditing = editingId === item.id || item.status === "missing";
            const statusLabel =
              item.status === "missing" ? "To do" : item.status === "done" ? "Done" : "Optional";
            const placeholder =
              item.validation?.placeholder ||
              (evidenceType === "Signature" ? "Signed by…" : evidenceType === "Number" ? "Enter reading…" : "Type here…");
            const maxLength = item.validation?.exactDigits || item.validation?.maxLength;
            return (
              <article
                className={`check-card is-${item.status}${isEditing ? " is-editing" : ""}`}
                key={item.id}
              >
                <header className="check-card-head">
                  <div className="check-card-copy">
                    <h3>{item.label}</h3>
                    <p className="check-card-meta">
                      {[item.stage, evidenceType, item.status === "optional" ? "Optional" : "Required"]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {item.status === "done" && summary && !isEditing ? (
                      <p className="check-card-value">{summary}</p>
                    ) : null}
                  </div>
                  <span className={`check-card-status is-${item.status}`}>{statusLabel}</span>
                </header>

                {item.status === "done" && !isEditing ? (
                  <div className="check-card-actions">
                    <button
                      type="button"
                      className="check-amend"
                      disabled={savingId === item.id}
                      onClick={() => void reopenRequirement(item.id)}
                    >
                      Amend
                    </button>
                  </div>
                ) : null}

                {isEditing && item.status !== "optional" ? (
                  <div className="check-card-capture">
                    {evidenceType === "Text" || evidenceType === "Signature" ? (
                      <label className="check-field">
                        <span>{evidenceType === "Signature" ? "Signed by" : "Answer"}</span>
                        <input
                          type="text"
                          inputMode={item.validation?.inputMode || "text"}
                          value={draft.text || ""}
                          placeholder={placeholder}
                          maxLength={maxLength}
                          onChange={(event) =>
                            setDraftByRequirement((current) => ({
                              ...current,
                              [item.id]: { ...current[item.id], text: event.target.value },
                            }))
                          }
                        />
                      </label>
                    ) : null}
                    {evidenceType === "Number" ? (
                      <label className="check-field">
                        <span>Reading</span>
                        <input
                          type="number"
                          inputMode={item.validation?.inputMode || "decimal"}
                          value={draft.numberValue || ""}
                          placeholder={placeholder}
                          onChange={(event) =>
                            setDraftByRequirement((current) => ({
                              ...current,
                              [item.id]: { ...current[item.id], numberValue: event.target.value },
                            }))
                          }
                        />
                      </label>
                    ) : null}
                    {evidenceType === "Photo" ? (
                      <label className="check-field">
                        <span>Photo</span>
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
                      </label>
                    ) : null}
                    {evidenceType === "Checkbox" ? (
                      <p className="check-card-hint muted">Confirm this check is complete on site.</p>
                    ) : null}
                    {item.validation?.helpText ? (
                      <p className="check-card-hint muted">{item.validation.helpText}</p>
                    ) : null}
                    <button
                      type="button"
                      className="check-save"
                      disabled={savingId === item.id}
                      onClick={() => void saveRequirement(item.id)}
                    >
                      {savingId === item.id
                        ? "Saving…"
                        : evidenceType === "Checkbox"
                          ? "Mark done"
                          : "Save"}
                    </button>
                  </div>
                ) : null}
              </article>
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
