"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AskBlakeChat } from "@/components/field/AskBlake";
import { AskBlakeVoice } from "@/components/field/AskBlakeVoice";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import { useNexaClient } from "@/lib/field/nexa";
import type { AskBlakeJobContext } from "@/lib/field/ask-blake";

type AskMode = "talk" | "type";

type AskBlakeStatus = {
  connected?: boolean;
  model?: string;
  warning?: string;
};

export default function AskBlakePage() {
  const client = useNexaClient();
  const searchParams = useSearchParams();
  const scheduleId = searchParams.get("job") ?? "";
  const [job, setJob] = useState<AskBlakeJobContext | null>(null);
  // Type is the reliable default for the pilot; Talk is optional push-to-talk.
  const [mode, setMode] = useState<AskMode>("type");
  const [status, setStatus] = useState<AskBlakeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!scheduleId) {
        setJob(null);
        return;
      }
      try {
        const item = await client.getJob(scheduleId);
        if (cancelled || !item) return;
        setJob({
          scheduleId: item.scheduleId,
          jobRef: item.jobRef,
          customer: item.customer,
          costCentre: item.costCentre,
          trade: item.trade,
          address: item.address,
          description: item.description,
          accessNotes: item.accessNotes,
          officeNotes: item.officeNotes,
          status: item.status,
        });
      } catch {
        if (!cancelled) setJob(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, scheduleId]);

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        const response = await fetch("/api/field/ask-blake", { method: "GET" });
        const body = (await response.json().catch(() => ({}))) as AskBlakeStatus & {
          error?: string;
          connected?: boolean;
        };
        if (cancelled) return;
        if (!response.ok) {
          setStatus({
            connected: false,
            warning: body.error || "Refresh and sign in to the pilot again.",
          });
          return;
        }
        setStatus({
          connected: Boolean(body.connected),
          model: body.model,
          warning: body.connected
            ? undefined
            : "OpenAI isn’t connected — Type still works with field fallback. Talk needs the voice key.",
        });
      } catch {
        if (!cancelled) {
          setStatus({
            connected: false,
            warning: "Couldn’t reach Ask Blake — check signal and refresh.",
          });
        }
      }
    }
    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={`field-screen ask-blake-page${mode === "talk" ? " is-talk" : ""}`}>
      <header className="ask-blake-hero">
        {mode === "type" ? <BlakeCharacter mood="idle" size="hero" /> : null}
        <div>
          <p className="eyebrow">Ask Blake</p>
          <h1>{mode === "talk" ? "Push to talk" : "Type or send photos"}</h1>
          <p className="field-page-sub">
            {job?.jobRef
              ? `${job.jobRef} · ${job.customer ?? "Job"}`
              : mode === "talk"
                ? "Start → speak the fault → I’m done. Blake answers once."
                : "Best path on this pilot — describe the fault or attach a photo."}
          </p>
        </div>
      </header>

      {status?.warning ? <div className="feedback">{status.warning}</div> : null}

      <div className="ask-blake-mode" role="tablist" aria-label="Ask Blake mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "type"}
          className={mode === "type" ? "active" : undefined}
          onClick={() => setMode("type")}
        >
          Type / photos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "talk"}
          className={mode === "talk" ? "active" : undefined}
          onClick={() => setMode("talk")}
        >
          Talk
        </button>
      </div>

      {mode === "talk" ? (
        <AskBlakeVoice job={job} openaiConnected={status?.connected ?? null} />
      ) : (
        <AskBlakeChat job={job} />
      )}
    </main>
  );
}
