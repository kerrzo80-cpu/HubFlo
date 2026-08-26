"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RecordLockType } from "@/lib/record-edit-locks";

export type RecordLockState = {
  loading: boolean;
  mode: "editor" | "viewer" | "idle";
  holderName: string | null;
  key: string | null;
  requestAccess: () => Promise<void>;
  readOnly: boolean;
};

type ActiveRecord = {
  recordType: RecordLockType;
  recordId: string;
} | null;

export function useRecordEditLock(active: ActiveRecord): RecordLockState {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"editor" | "viewer" | "idle">("idle");
  const [holderName, setHolderName] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const heldKeyRef = useRef<string | null>(null);

  const releaseHeld = useCallback(async (lockKey: string | null) => {
    if (!lockKey) return;
    try {
      await fetch("/api/record-locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "release", key: lockKey }),
      });
    } catch {
      // best effort
    }
  }, []);

  useEffect(() => {
    if (!active?.recordId) {
      void releaseHeld(heldKeyRef.current);
      heldKeyRef.current = null;
      setMode("idle");
      setHolderName(null);
      setKey(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function acquire() {
      setLoading(true);
      try {
        const response = await fetch("/api/record-locks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({
            action: "acquire",
            recordType: active!.recordType,
            recordId: active!.recordId,
          }),
        });
        if (!response.ok || cancelled) return;
        const body = await response.json() as {
          mode?: "editor" | "viewer";
          lock?: { key: string; holderName: string } | null;
        };
        const nextKey = body.lock?.key ?? null;
        if (heldKeyRef.current && heldKeyRef.current !== nextKey) {
          await releaseHeld(heldKeyRef.current);
        }
        heldKeyRef.current = body.mode === "editor" ? nextKey : null;
        setKey(nextKey);
        setMode(body.mode ?? "editor");
        setHolderName(body.lock?.holderName ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void acquire();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active?.recordId, active?.recordType, releaseHeld]);

  useEffect(() => {
    if (mode !== "editor" || !key) return;
    const timer = window.setInterval(() => {
      void fetch("/api/record-locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "heartbeat", key }),
      });
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [mode, key]);

  useEffect(() => {
    return () => {
      void releaseHeld(heldKeyRef.current);
      heldKeyRef.current = null;
    };
  }, [releaseHeld]);

  const requestAccess = useCallback(async () => {
    if (!key) return;
    await fetch("/api/record-locks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "request-access", key }),
    });
  }, [key]);

  return {
    loading,
    mode: active?.recordId ? mode : "idle",
    holderName,
    key,
    requestAccess,
    readOnly: mode === "viewer",
  };
}

export function activeRecordFromHomeView(input: {
  homeView: string;
  selectedLeadId: string | null;
  selectedQuoteId: string | null;
  selectedJobId: string | null;
  selectedInvoiceId: string | null;
  selectedPurchaseRequestId: string | null;
  selectedTenderId: string | null;
}): ActiveRecord {
  if (input.homeView === "lead-record" && input.selectedLeadId) {
    return { recordType: "lead", recordId: input.selectedLeadId };
  }
  if ((input.homeView === "quote-record" || input.homeView === "quote-cost-centre-record") && input.selectedQuoteId) {
    return { recordType: "quote", recordId: input.selectedQuoteId };
  }
  if ((input.homeView === "job-record" || input.homeView === "cost-centre-record") && input.selectedJobId) {
    return { recordType: "job", recordId: input.selectedJobId };
  }
  if (input.homeView === "invoice-record" && input.selectedInvoiceId) {
    return { recordType: "invoice", recordId: input.selectedInvoiceId };
  }
  if (input.homeView === "purchase-order-record" && input.selectedPurchaseRequestId) {
    return { recordType: "po", recordId: input.selectedPurchaseRequestId };
  }
  if (input.homeView === "tenders" && input.selectedTenderId) {
    return { recordType: "tender", recordId: input.selectedTenderId };
  }
  return null;
}
