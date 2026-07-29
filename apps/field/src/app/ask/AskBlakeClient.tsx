"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AskBlakeChat } from "@/components/AskBlake";
import { BlakeCharacter } from "@/components/BlakeCharacter";
import { useNexaClient } from "@/lib/nexa";
import type { AskBlakeJobContext } from "@/lib/ask-blake";

export default function AskBlakePage() {
  const client = useNexaClient();
  const searchParams = useSearchParams();
  const scheduleId = searchParams.get("job") ?? "";
  const [job, setJob] = useState<AskBlakeJobContext | null>(null);

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
    <main className="field-screen ask-blake-page">
      <header className="field-page-header blake-header">
        <BlakeCharacter mood="guide" size="md" />
        <div>
          <p className="eyebrow">Field co-pilot</p>
          <h1>Ask Blake</h1>
          <p className="field-page-sub">
            {job?.jobRef
              ? `${job.jobRef} · ${job.customer ?? "Job"}`
              : "Diagnose faults, steps, tools — and when to escalate"}
          </p>
        </div>
      </header>

      <AskBlakeChat job={job} />
    </main>
  );
}
