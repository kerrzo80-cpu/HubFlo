"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AskBlakeChat } from "@/components/field/AskBlake";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import { useNexaClient } from "@/lib/field/nexa";
import type { AskBlakeJobContext } from "@/lib/field/ask-blake";

type AskBlakeStatus = {
  connected?: boolean;
  warning?: string;
};

export default function AskBlakePage() {
  const client = useNexaClient();
  const searchParams = useSearchParams();
  const scheduleId = searchParams.get("job") ?? "";
  const [job, setJob] = useState<AskBlakeJobContext | null>(null);
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
          warning: body.connected
            ? undefined
            : "OpenAI isn’t connected — Blake can still use the field fallback.",
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

  const blakeMood =
    status == null ? "idle" : status.connected === false ? "alert" : job ? "guide" : "idle";

  return (
    <main className="field-screen ask-blake-page">
      <header className="ask-blake-hero">
        <BlakeCharacter mood={blakeMood} size="hero" />
        <div>
          <p className="eyebrow">Blake · on-site AI</p>
          <h1>Ask Blake</h1>
          <p className="field-page-sub">
            {job?.jobRef
              ? `${job.jobRef} · ${job.customer ?? "Job"} — describe the fault or attach media.`
              : "Your site backbone. Describe the fault, or attach a photo or short video for cause, checks and next steps."}
          </p>
          {status ? (
            <span className={`ask-blake-live-chip ${status.connected ? "is-live" : "is-soft"}`}>
              <BlakeCharacter mood={status.connected ? "good" : "alert"} size="sm" />
              {status.connected ? "Blake live" : "Blake fallback"}
            </span>
          ) : null}
        </div>
      </header>

      {status?.warning ? <div className="feedback">{status.warning}</div> : null}

      <AskBlakeChat job={job} />
    </main>
  );
}
