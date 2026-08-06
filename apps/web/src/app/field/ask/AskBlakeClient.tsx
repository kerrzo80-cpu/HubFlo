"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AskBlakeChat } from "@/components/field/AskBlake";
import { AskBlakeTalkLab } from "@/components/field/AskBlakeTalkLab";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import { useNexaClient } from "@/lib/field/nexa";
import type { AskBlakeJobContext } from "@/lib/field/ask-blake";

type AskBlakeMode = "type" | "talk";

type AskBlakeStatus = {
  connected?: boolean;
  warning?: string;
};

export default function AskBlakePage() {
  const client = useNexaClient();
  const searchParams = useSearchParams();
  const scheduleId = searchParams.get("job") ?? "";
  const [mode, setMode] = useState<AskBlakeMode>("type");
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

  return (
    <main className={`field-screen ask-blake-page${mode === "talk" ? " is-talk" : ""}`}>
      <header className="ask-blake-hero">
        <BlakeCharacter mood="idle" size="hero" />
        <div>
          <p className="eyebrow">Ask Blake</p>
          <h1>{mode === "talk" ? "Talk with Blake" : "Type, photos or video"}</h1>
          <p className="field-page-sub">
            {job?.jobRef
              ? `${job.jobRef} · ${job.customer ?? "Job"}`
              : mode === "talk"
                ? "Hands-free call — talk naturally and optional camera so Blake can see the job."
                : "Describe the fault or attach a photo or short video — likely cause, checks, next steps."}
          </p>
        </div>
      </header>

      <div className="ask-blake-mode" role="tablist" aria-label="Ask Blake mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "type"}
          className={mode === "type" ? "active" : undefined}
          onClick={() => setMode("type")}
        >
          Type
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

      {status?.warning ? <div className="feedback">{status.warning}</div> : null}

      {mode === "type" ? (
        <AskBlakeChat job={job} />
      ) : (
        <AskBlakeTalkLab variant="app" />
      )}
    </main>
  );
}
