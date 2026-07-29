"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AskBlakeChat } from "@/components/field/AskBlake";
import { AskBlakeVoice } from "@/components/field/AskBlakeVoice";
import { BlakeCharacter } from "@/components/field/BlakeCharacter";
import { useNexaClient } from "@/lib/field/nexa";
import type { AskBlakeJobContext } from "@/lib/field/ask-blake";

type AskMode = "talk" | "type";

export default function AskBlakePage() {
  const client = useNexaClient();
  const searchParams = useSearchParams();
  const scheduleId = searchParams.get("job") ?? "";
  const [job, setJob] = useState<AskBlakeJobContext | null>(null);
  const [mode, setMode] = useState<AskMode>("talk");

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

  return (
    <main className={`field-screen ask-blake-page${mode === "talk" ? " is-talk" : ""}`}>
      <header className="ask-blake-hero">
        {mode === "type" ? <BlakeCharacter mood="idle" size="hero" /> : null}
        <div>
          <p className="eyebrow">Ask Blake</p>
          <h1>{mode === "talk" ? "Talk it through" : "Your smart monitoring buddy"}</h1>
          <p className="field-page-sub">
            {job?.jobRef
              ? `${job.jobRef} · ${job.customer ?? "Job"}`
              : mode === "talk"
                ? "Hands-free on site — Blake listens and answers out loud"
                : "Friendly, alert, reliable. Spot the issue and talk through the next checks."}
          </p>
        </div>
      </header>

      <div className="ask-blake-mode" role="tablist" aria-label="Ask Blake mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "talk"}
          className={mode === "talk" ? "active" : undefined}
          onClick={() => setMode("talk")}
        >
          Talk
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "type"}
          className={mode === "type" ? "active" : undefined}
          onClick={() => setMode("type")}
        >
          Type / photos
        </button>
      </div>

      {mode === "talk" ? <AskBlakeVoice job={job} /> : <AskBlakeChat job={job} />}
    </main>
  );
}
