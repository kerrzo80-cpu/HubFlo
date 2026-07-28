"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  MessageCircle,
  Send,
  TriangleAlert,
} from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/field/BlakeCharacter";
import { useNexaClient } from "@/lib/field/nexa";
import { formatDuration } from "@/lib/field/format";
import type { DailyTimeCheck, TimeCheckLine, TimeCheckSummary } from "@/lib/field/types";

type Bubble = { id: string; role: "blake" | "you"; text: string };

function nextPending(lines: TimeCheckLine[]) {
  return lines.find((line) => line.status === "pending") ?? null;
}

function moodFor(check: DailyTimeCheck | null, summary: TimeCheckSummary | null): BlakeMood {
  if (!check || !summary) return "idle";
  if (check.status === "submitted") return "good";
  if (summary.pendingCount > 0) return "guide";
  if (summary.amendedCount > 0) return "thinking";
  return "idle";
}

export function BlakeTimeCheck() {
  const client = useNexaClient();
  const [check, setCheck] = useState<DailyTimeCheck | null>(null);
  const [summary, setSummary] = useState<TimeCheckSummary | null>(null);
  const [chat, setChat] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [draftBreak, setDraftBreak] = useState("0");
  const [draftNote, setDraftNote] = useState("");

  const current = useMemo(() => (check ? nextPending(check.lines) : null), [check]);
  const mood = moodFor(check, summary);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setBusy(true);
      try {
        const result = await client.getTimeCheck();
        if (cancelled) return;
        setCheck(result.check);
        setSummary(result.summary);
        const pending = nextPending(result.check.lines);
        if (result.check.status === "submitted") {
          setChat([{
            id: "done",
            role: "blake",
            text: `All set — ${result.summary.actualHours.toFixed(1)} hrs charged against today's jobs (${result.summary.amendedCount} amended).`,
          }]);
        } else if (pending) {
          setChat([{
            id: `ask-${pending.scheduleId}`,
            role: "blake",
            text: `End of day check. For ${pending.customer} (${pending.jobRef}) you were booked ${pending.scheduledStart}-${pending.scheduledEnd} — ${formatDuration(pending.scheduledHours)}. Did that match, or do we amend it?`,
          }]);
        } else {
          setChat([{
            id: "ready",
            role: "blake",
            text: `Every job is reviewed. Submit and I'll charge ${result.summary.actualHours.toFixed(1)} hrs against the work.`,
          }]);
        }
      } catch (bootError) {
        if (!cancelled) setError(bootError instanceof Error ? bootError.message : "Blake could not load today.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!current || editing) return;
    setDraftStart(current.actualStart);
    setDraftEnd(current.actualEnd);
    setDraftBreak(String(current.breakMinutes));
    setDraftNote(current.note);
  }, [current, editing]);

  async function afterUpdate(result: { check: DailyTimeCheck; summary: TimeCheckSummary }, youSaid: string) {
    setCheck(result.check);
    setSummary(result.summary);
    setEditing(false);
    setChat((prev) => [...prev, { id: `you-${Date.now()}`, role: "you", text: youSaid }]);
    const pending = nextPending(result.check.lines);
    if (result.check.status === "submitted") {
      setChat((prev) => [...prev, {
        id: `blake-${Date.now()}`,
        role: "blake",
        text: `Submitted. Actual hours are charged against each job. Variance today: ${result.summary.varianceHours >= 0 ? "+" : ""}${result.summary.varianceHours.toFixed(1)} hrs.`,
      }]);
      return;
    }
    if (pending) {
      setChat((prev) => [...prev, {
        id: `blake-${Date.now()}`,
        role: "blake",
        text: `Got it. Next: ${pending.customer} (${pending.jobRef}) booked ${pending.scheduledStart}-${pending.scheduledEnd}. Confirm or amend?`,
      }]);
      return;
    }
    setChat((prev) => [...prev, {
      id: `blake-${Date.now()}`,
      role: "blake",
      text: `That's every job. Ready to submit ${result.summary.actualHours.toFixed(1)} hrs?`,
    }]);
  }

  async function confirmCurrent() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.updateTimeLine({ scheduleId: current.scheduleId, confirmAsScheduled: true });
      await afterUpdate(result, `Confirm ${current.jobRef} as scheduled.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAmendment() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.updateTimeLine({
        scheduleId: current.scheduleId,
        actualStart: draftStart,
        actualEnd: draftEnd,
        breakMinutes: Number(draftBreak) || 0,
        note: draftNote || `Amended with Blake from ${current.scheduledHours}h booked.`,
      });
      await afterUpdate(result, `Amend ${current.jobRef} to ${draftStart}-${draftEnd}.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(confirmRemaining = false) {
    setBusy(true);
    setError("");
    try {
      const result = await client.submitTimeCheck(confirmRemaining);
      await afterUpdate(
        result,
        confirmRemaining ? "Confirm remaining as scheduled and submit." : "Submit reviewed hours.",
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not submit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="blake-time">
      <section className="hero blake-hero">
        <div className="blake-hero-row">
          <BlakeCharacter mood={mood} size="lg" />
          <div>
            <p className="eyebrow">Blake · Daily time check</p>
            <h1>Quick time check</h1>
            <p>
              Confirm as booked, or amend if it ran long or short. Those hours charge against the job.
            </p>
          </div>
        </div>
        {summary ? (
          <div className="meta-row">
            <span>{check?.lines.length ?? 0} jobs</span>
            <span>{formatDuration(summary.scheduledHours)} booked</span>
            <span>{formatDuration(summary.actualHours)} actual</span>
            <span>
              {summary.varianceHours === 0
                ? "On plan"
                : `${summary.varianceHours > 0 ? "+" : "−"}${formatDuration(Math.abs(summary.varianceHours))}`}
            </span>
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="feedback error">
          <TriangleAlert size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">With Blake</p>
            <h2>Review today&apos;s jobs</h2>
          </div>
          <MessageCircle size={20} />
        </div>
        <div className="chat-log">
          {chat.map((bubble) => (
            <article key={bubble.id} className={`chat-bubble ${bubble.role}`}>
              {bubble.role === "blake" ? <BlakeCharacter mood={mood} size="sm" /> : null}
              <p>{bubble.text}</p>
            </article>
          ))}
          {busy ? (
            <article className="chat-bubble blake">
              <BlakeCharacter mood="thinking" size="sm" />
              <p>Blake is updating the jobs…</p>
            </article>
          ) : null}
        </div>

        {current && check?.status !== "submitted" ? (
          <div className="blake-actions">
            <div className="current-job">
              <strong>{current.customer}</strong>
              <span>
                {current.jobRef} · {current.costCentre} · booked {current.scheduledStart}-{current.scheduledEnd}
              </span>
            </div>
            {!editing ? (
              <div className="action-row">
                <button type="button" disabled={busy} onClick={() => void confirmCurrent()}>
                  <CheckCircle2 size={17} /> As scheduled
                </button>
                <button type="button" disabled={busy} onClick={() => setEditing(true)}>
                  <Clock3 size={17} /> Amend hours
                </button>
                <button type="button" disabled={busy} onClick={() => void submit(true)}>
                  Confirm rest &amp; submit
                </button>
              </div>
            ) : (
              <form
                className="time-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveAmendment();
                }}
              >
                <label>
                  Actual start
                  <input type="time" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} />
                </label>
                <label>
                  Actual finish
                  <input type="time" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} />
                </label>
                <label>
                  Break mins
                  <input inputMode="numeric" value={draftBreak} onChange={(event) => setDraftBreak(event.target.value)} />
                </label>
                <label className="full">
                  Why the change?
                  <textarea
                    value={draftNote}
                    onChange={(event) => setDraftNote(event.target.value)}
                    rows={2}
                    placeholder="e.g. Extra fault / finished early / waiting on parts"
                  />
                </label>
                <button className="full" type="submit" disabled={busy}>
                  <Send size={17} /> Save with Blake
                </button>
                <button className="full ghost" type="button" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        ) : null}

        {!current && check?.status !== "submitted" ? (
          <div className="action-row">
            <button type="button" disabled={busy} onClick={() => void submit(false)}>
              <Send size={17} /> Submit hours to jobs
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Charge against jobs</p>
            <h2>Today&apos;s lines</h2>
          </div>
          <Clock3 size={20} />
        </div>
        <div className="line-list">
          {(check?.lines ?? []).map((line) => (
            <div key={line.scheduleId} className={`line-item ${line.status}`}>
              <div>
                <strong>
                  {line.customer} · {line.jobRef}
                </strong>
                <span>
                  Booked {line.scheduledStart}-{line.scheduledEnd} ({formatDuration(line.scheduledHours)})
                  {line.status !== "pending"
                    ? ` → actual ${line.actualStart}-${line.actualEnd} (${formatDuration(line.actualHours)})`
                    : " · waiting on Blake"}
                </span>
              </div>
              <em>{line.status === "pending" ? "Pending" : line.status === "amended" ? "Amended" : "Confirmed"}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
