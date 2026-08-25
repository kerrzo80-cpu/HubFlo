"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Send,
  TriangleAlert,
} from "lucide-react";
import { BlakeCharacter, type BlakeMood } from "@/components/field/BlakeCharacter";
import { useNexaClient } from "@/lib/field/nexa";
import {
  postFieldTimeCheck,
  readCachedTimeCheck,
  saveCachedTimeCheck,
} from "@/lib/field/field-time-check-offline";
import { isBrowserOnline } from "@/lib/field/offline-outbox";
import { formatDuration } from "@/lib/field/format";
import type { DailyTimeCheck, TimeCheckLine, TimeCheckSummary } from "@/lib/field/types";

type Bubble = { id: string; role: "blake" | "you"; text: string };

const FIELD_OFFLINE_NOTICE = "Saved offline — will sync when online";

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
  const [notice, setNotice] = useState("");
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
        if (!isBrowserOnline()) {
          const cached = readCachedTimeCheck();
          if (cached && !cancelled) {
            setCheck(cached.check);
            setSummary(cached.summary);
            setNotice("Showing saved hours — changes will sync when you are back online.");
            seedChat(cached.check, cached.summary);
            return;
          }
        }

        const result = await client.getTimeCheck();
        if (cancelled) return;
        setCheck(result.check);
        setSummary(result.summary);
        saveCachedTimeCheck(result.check, result.summary);
        seedChat(result.check, result.summary);
      } catch (bootError) {
        if (!cancelled) {
          const cached = readCachedTimeCheck();
          if (cached) {
            setCheck(cached.check);
            setSummary(cached.summary);
            setNotice("Showing saved hours — changes will sync when you are back online.");
            seedChat(cached.check, cached.summary);
            return;
          }
          setError(bootError instanceof Error ? bootError.message : "Blake could not load today.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    function seedChat(nextCheck: DailyTimeCheck, nextSummary: TimeCheckSummary) {
      const pending = nextPending(nextCheck.lines);
      if (nextCheck.status === "submitted") {
        setChat([{
          id: "done",
          role: "blake",
          text: `All set — ${nextSummary.actualHours.toFixed(1)} hrs charged against today's jobs (${nextSummary.amendedCount} amended).`,
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
          text: `Every job is reviewed. Submit and I'll charge ${nextSummary.actualHours.toFixed(1)} hrs against the work.`,
        }]);
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

  async function afterUpdate(
    result: { check: DailyTimeCheck; summary: TimeCheckSummary; offline?: boolean },
    youSaid: string,
  ) {
    setCheck(result.check);
    setSummary(result.summary);
    setEditing(false);
    setNotice(result.offline ? FIELD_OFFLINE_NOTICE : "");
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
    if (!current || !check) return;
    setBusy(true);
    setError("");
    try {
      const result = await postFieldTimeCheck(
        {
          action: "update_line",
          payload: { scheduleId: current.scheduleId, confirmAsScheduled: true },
        },
        check,
      );
      await afterUpdate(result, `Confirm ${current.jobRef} as scheduled.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAmendment() {
    if (!current || !check) return;
    setBusy(true);
    setError("");
    try {
      const result = await postFieldTimeCheck(
        {
          action: "update_line",
          payload: {
            scheduleId: current.scheduleId,
            actualStart: draftStart,
            actualEnd: draftEnd,
            breakMinutes: Number(draftBreak) || 0,
            note: draftNote || `Amended with Blake from ${current.scheduledHours}h booked.`,
          },
        },
        check,
      );
      await afterUpdate(result, `Amend ${current.jobRef} to ${draftStart}-${draftEnd}.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(confirmRemaining = false) {
    if (!check) return;
    setBusy(true);
    setError("");
    try {
      const result = await postFieldTimeCheck(
        {
          action: "submit",
          payload: { confirmRemainingAsScheduled: confirmRemaining },
        },
        check,
      );
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
    <div className="field-screen blake-time">
      <header className="field-page-header blake-header">
        <BlakeCharacter mood={mood} size="md" />
        <div>
          <p className="eyebrow">Hours</p>
          <h1>Time check</h1>
          <p className="field-page-sub">
            {summary
              ? `${formatDuration(summary.actualHours)} actual · ${summary.pendingCount} left`
              : "Confirm or amend each job"}
          </p>
        </div>
      </header>

      {notice ? <div className="feedback">{notice}</div> : null}

      {error ? (
        <div className="feedback error">
          <TriangleAlert size={18} />
          <span>{error}</span>
        </div>
      ) : null}

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
            <p>Updating…</p>
          </article>
        ) : null}
      </div>

      {current && check?.status !== "submitted" ? (
        <div className="blake-actions">
          <div className="current-job">
            <strong>{current.customer}</strong>
            <span>
              {current.jobRef} · booked {current.scheduledStart}–{current.scheduledEnd}
            </span>
          </div>
          {!editing ? (
            <div className="action-row">
              <button type="button" disabled={busy} onClick={() => void confirmCurrent()}>
                <CheckCircle2 size={17} /> As scheduled
              </button>
              <button type="button" disabled={busy} onClick={() => setEditing(true)}>
                <Clock3 size={17} /> Amend
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
                Start
                <input type="time" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} />
              </label>
              <label>
                Finish
                <input type="time" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} />
              </label>
              <label className="full">
                Note
                <textarea
                  value={draftNote}
                  onChange={(event) => setDraftNote(event.target.value)}
                  rows={2}
                  placeholder="Why the change?"
                />
              </label>
              <button className="full" type="submit" disabled={busy}>
                <Send size={17} /> Save
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
            <Send size={17} /> Submit hours
          </button>
        </div>
      ) : null}

      <div className="line-list">
        {(check?.lines ?? []).map((line) => (
          <div key={line.scheduleId} className={`line-item ${line.status}`}>
            <div>
              <strong>{line.customer}</strong>
              <span>
                {line.status === "pending"
                  ? `${line.scheduledStart}–${line.scheduledEnd}`
                  : `${line.actualStart}–${line.actualEnd} · ${formatDuration(line.actualHours)}`}
              </span>
            </div>
            <em>{line.status === "pending" ? "Next" : line.status === "amended" ? "Amended" : "Done"}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
