"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  MessageCircle,
  Send,
  TriangleAlert,
} from "lucide-react";
import { BuddyCharacter, type BlakeMood } from "@/lib/BuddyCharacter";
import { formatDuration } from "@/lib/engineer-data";
import type { DailyTimeCheck, TimeCheckLine } from "@/lib/engineer-time-check-store";

type TimeCheckSummary = {
  scheduledHours: number;
  actualHours: number;
  varianceHours: number;
  amendedCount: number;
  pendingCount: number;
  confirmedCount: number;
  gapHours: number;
};

type ChatBubble = {
  id: string;
  role: "blake" | "you";
  text: string;
};

function nextPending(lines: TimeCheckLine[]) {
  return lines.find((line) => line.status === "pending") ?? null;
}

function blakeMoodFor(check: DailyTimeCheck | null, summary: TimeCheckSummary | null): BlakeMood {
  if (!check || !summary) return "idle";
  if (check.status === "submitted") return "good";
  if (summary.pendingCount > 0) return "guide";
  if (summary.amendedCount > 0) return "thinking";
  return "idle";
}

function varianceLabel(line: TimeCheckLine) {
  const variance = Number((line.actualHours - line.scheduledHours).toFixed(2));
  if (variance === 0) return "Matches schedule";
  if (variance > 0) return `+${formatDuration(variance)} over schedule`;
  return `${formatDuration(Math.abs(variance))} under schedule`;
}

export default function BlakeTimeCheckClient() {
  const [check, setCheck] = useState<DailyTimeCheck | null>(null);
  const [summary, setSummary] = useState<TimeCheckSummary | null>(null);
  const [chat, setChat] = useState<ChatBubble[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [draftBreak, setDraftBreak] = useState("0");
  const [draftNote, setDraftNote] = useState("");

  const current = useMemo(() => (check ? nextPending(check.lines) : null), [check]);
  const mood = blakeMoodFor(check, summary);

  async function loadOrPrompt(promptBlake: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/engineer/time-check", {
        method: promptBlake ? "POST" : "GET",
        headers: promptBlake ? { "Content-Type": "application/json" } : undefined,
        body: promptBlake ? JSON.stringify({ action: "prompt", payload: {} }) : undefined,
      });
      const body = (await response.json()) as {
        check?: DailyTimeCheck;
        summary?: TimeCheckSummary;
        error?: string;
      };
      if (!response.ok || !body.check || !body.summary) {
        throw new Error(body.error ?? "Blake could not load today's schedule.");
      }
      setCheck(body.check);
      setSummary(body.summary);
      const pending = nextPending(body.check.lines);
      if (body.check.status === "submitted") {
        setChat([
          {
            id: "submitted",
            role: "blake",
            text: `All set — today's hours are charged to the jobs. ${body.summary.actualHours.toFixed(1)} hrs against the work, ${body.summary.amendedCount} amended.`,
          },
        ]);
      } else if (pending) {
        setChat([
          {
            id: `ask-${pending.scheduleId}`,
            role: "blake",
            text: `End of day check. For ${pending.customer} (${pending.jobRef}) you were booked ${pending.scheduledStart}-${pending.scheduledEnd} — ${formatDuration(pending.scheduledHours)}. Did that match what you actually did, or do we need to amend it?`,
          },
        ]);
      } else {
        setChat([
          {
            id: "ready-submit",
            role: "blake",
            text: `Nice one. Every job is reviewed. Tap submit and I'll charge ${body.summary.actualHours.toFixed(1)} hrs against today's jobs.`,
          },
        ]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to start Blake time check.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadOrPrompt(true);
  }, []);

  useEffect(() => {
    if (!current || editing) return;
    setDraftStart(current.actualStart);
    setDraftEnd(current.actualEnd);
    setDraftBreak(String(current.breakMinutes));
    setDraftNote(current.note);
  }, [current, editing]);

  async function runAction(action: string, payload: Record<string, unknown>, youSaid: string) {
    setBusy(true);
    setError("");
    setNotice("");
    setChat((prev) => [
      ...prev,
      { id: `you-${Date.now()}`, role: "you", text: youSaid },
    ]);
    try {
      const response = await fetch("/api/engineer/time-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const body = (await response.json()) as {
        check?: DailyTimeCheck;
        summary?: TimeCheckSummary;
        error?: string;
      };
      if (!response.ok || !body.check || !body.summary) {
        throw new Error(body.error ?? "Blake could not save that.");
      }
      setCheck(body.check);
      setSummary(body.summary);
      setEditing(false);

      const nextSummary = body.summary;
      const pending = nextPending(body.check.lines);
      if (body.check.status === "submitted") {
        setChat((prev) => [
          ...prev,
          {
            id: `blake-done-${Date.now()}`,
            role: "blake",
            text: `Submitted. Actual hours are now charged against each job for office / Simpro review. Variance today: ${nextSummary.varianceHours >= 0 ? "+" : ""}${nextSummary.varianceHours.toFixed(1)} hrs.`,
          },
        ]);
        setNotice("Daily time check submitted.");
        return;
      }
      if (pending) {
        setChat((prev) => [
          ...prev,
          {
            id: `blake-next-${pending.scheduleId}-${Date.now()}`,
            role: "blake",
            text: `Got it. Next up: ${pending.customer} (${pending.jobRef}) booked ${pending.scheduledStart}-${pending.scheduledEnd}. Same again — confirm or amend?`,
          },
        ]);
      } else {
        setChat((prev) => [
          ...prev,
          {
            id: `blake-ready-${Date.now()}`,
            role: "blake",
            text: `That's every job reviewed. Ready to submit ${nextSummary.actualHours.toFixed(1)} hrs against today's work?`,
          },
        ]);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update time check.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCurrent() {
    if (!current || !check) return;
    await runAction(
      "update_line",
      {
        date: check.date,
        engineerId: check.engineerId,
        scheduleId: current.scheduleId,
        confirmAsScheduled: true,
      },
      `Confirm ${current.jobRef} as scheduled (${current.scheduledStart}-${current.scheduledEnd}).`,
    );
  }

  async function saveAmendment() {
    if (!current || !check) return;
    await runAction(
      "update_line",
      {
        date: check.date,
        engineerId: check.engineerId,
        scheduleId: current.scheduleId,
        actualStart: draftStart,
        actualEnd: draftEnd,
        breakMinutes: Number(draftBreak) || 0,
        note: draftNote || `Amended with Blake from ${current.scheduledHours}h booked.`,
      },
      `Amend ${current.jobRef} to ${draftStart}-${draftEnd}${Number(draftBreak) ? ` (${draftBreak}m break)` : ""}.`,
    );
  }

  async function confirmAllRemaining() {
    if (!check) return;
    await runAction(
      "submit",
      {
        date: check.date,
        engineerId: check.engineerId,
        confirmRemainingAsScheduled: true,
      },
      "Confirm remaining jobs as scheduled and submit.",
    );
  }

  async function submitReviewed() {
    if (!check) return;
    await runAction(
      "submit",
      {
        date: check.date,
        engineerId: check.engineerId,
        confirmRemainingAsScheduled: false,
      },
      "Submit reviewed hours.",
    );
  }

  return (
    <main className="engineer-shell job-detail-shell">
      <Link href="/engineer" className="engineer-back-link">
        <ArrowLeft size={17} /> Back to My Day
      </Link>

      <section className="engineer-job-detail-hero blake-time-hero">
        <div className="blake-time-hero-row">
          <BuddyCharacter mood={mood} size="lg" interactive={false} />
          <div>
            <p className="eyebrow">Blake · Daily time check</p>
            <h1>Quick time check</h1>
            <p>
              Blake walks each job with you. Confirm as booked, or amend if it took longer or less —
              those hours are what get charged against the job.
            </p>
          </div>
        </div>
        {summary ? (
          <div className="engineer-detail-meta">
            <span>{check?.lines.length ?? 0} jobs</span>
            <span>{formatDuration(summary.scheduledHours)} booked</span>
            <span>{formatDuration(summary.actualHours)} actual</span>
            <span>
              {summary.varianceHours === 0
                ? "On plan"
                : `${summary.varianceHours > 0 ? "+" : ""}${formatDuration(Math.abs(summary.varianceHours))} variance`}
            </span>
          </div>
        ) : null}
      </section>

      {error || notice ? (
        <section className={`engineer-feedback ${error ? "error" : ""}`}>
          {error ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
        </section>
      ) : null}

      <section className="engineer-panel blake-chat-panel" aria-label="Blake time check chat">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">With Blake</p>
            <h2>Review today&apos;s jobs</h2>
          </div>
          <MessageCircle size={21} />
        </div>
        <div className="blake-chat-log">
          {chat.map((bubble) => (
            <article className={`blake-chat-bubble ${bubble.role}`} key={bubble.id}>
              {bubble.role === "blake" ? <BuddyCharacter mood={mood} size="sm" interactive={false} /> : null}
              <p>{bubble.text}</p>
            </article>
          ))}
          {busy ? (
            <article className="blake-chat-bubble blake thinking">
              <BuddyCharacter mood="thinking" size="sm" interactive={false} />
              <p>Blake is updating the jobs…</p>
            </article>
          ) : null}
        </div>

        {current && check?.status !== "submitted" ? (
          <div className="blake-time-actions">
            <div className="blake-current-job">
              <strong>{current.customer}</strong>
              <span>
                {current.jobRef} · {current.costCentre} · booked {current.scheduledStart}-{current.scheduledEnd}
              </span>
            </div>
            {!editing ? (
              <div className="engineer-inline-actions">
                <button type="button" disabled={busy} onClick={() => void confirmCurrent()}>
                  <CheckCircle2 size={17} /> As scheduled
                </button>
                <button type="button" disabled={busy} onClick={() => setEditing(true)}>
                  <Clock3 size={17} /> Amend hours
                </button>
                <button type="button" disabled={busy} onClick={() => void confirmAllRemaining()}>
                  Confirm rest &amp; submit
                </button>
              </div>
            ) : (
              <form
                className="engineer-time-form"
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
                    placeholder="e.g. Extra fault found / finished early / waiting on parts"
                    rows={2}
                  />
                </label>
                <button className="full" type="submit" disabled={busy}>
                  <Send size={17} /> Save amended hours with Blake
                </button>
                <button className="full" type="button" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        ) : null}

        {!current && check?.status !== "submitted" ? (
          <div className="engineer-inline-actions">
            <button type="button" disabled={busy} onClick={() => void submitReviewed()}>
              <Send size={17} /> Submit hours to jobs
            </button>
          </div>
        ) : null}
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Charge against jobs</p>
            <h2>Today&apos;s lines</h2>
          </div>
          <Clock3 size={21} />
        </div>
        <div className="engineer-requirement-list">
          {(check?.lines ?? []).map((line) => (
            <div className={`engineer-requirement ${line.status === "pending" ? "missing" : "done"}`} key={line.scheduleId}>
              <div>
                <span>
                  {line.customer} · {line.jobRef}
                </span>
                <small>
                  Booked {line.scheduledStart}-{line.scheduledEnd} ({formatDuration(line.scheduledHours)})
                  {line.status !== "pending"
                    ? ` → actual ${line.actualStart}-${line.actualEnd} (${formatDuration(line.actualHours)}) · ${varianceLabel(line)}`
                    : " · waiting on Blake review"}
                </small>
              </div>
              <strong>{line.status === "pending" ? "Pending" : line.status === "amended" ? "Amended" : "Confirmed"}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
