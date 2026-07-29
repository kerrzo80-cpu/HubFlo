"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AskBlakeChat } from "@/components/AskBlake";
import { BlakeCharacter } from "@/components/BlakeCharacter";
import { useNexaClient } from "@/lib/nexa";
import type { AskBlakeJobContext } from "@/lib/ask-blake";

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
        const response = await fetch("/api/ask-blake", { method: "GET" });
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
            : "OpenAI isn’t connected on this pilot — Blake will use field fallback answers.",
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
    <main className="field-screen ask-blake-page">
      <header className="ask-blake-hero">
        <BlakeCharacter mood="idle" size="hero" />
        <div>
          <p className="eyebrow">Ask Blake</p>
          <h1>Type or send photos</h1>
          <p className="field-page-sub">
            {job?.jobRef
              ? `${job.jobRef} · ${job.customer ?? "Job"}`
              : "Describe the fault or attach a photo — likely cause, checks, next steps."}
          </p>
        </div>
      </header>

      {status?.warning ? <div className="feedback">{status.warning}</div> : null}

      <AskBlakeChat job={job} />
    </main>
  );
}
