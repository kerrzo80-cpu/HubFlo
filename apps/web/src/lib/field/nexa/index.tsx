"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createHttpNexaClient, createMockNexaClient } from "@/lib/field/nexa/client";
import type { NexaFieldClient } from "@/lib/field/types";

const NexaClientContext = createContext<NexaFieldClient | null>(null);

/**
 * Field mounted in @hubflo/web talks to Core on the same origin.
 * Set NEXT_PUBLIC_FIELD_DATA_MODE=mock to force the standalone demo diary.
 */
export function NexaClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const mode = (process.env.NEXT_PUBLIC_FIELD_DATA_MODE || "core").toLowerCase();
    if (mode === "mock") return createMockNexaClient();
    return createHttpNexaClient("");
  }, []);
  return <NexaClientContext.Provider value={client}>{children}</NexaClientContext.Provider>;
}

export function useNexaClient() {
  const client = useContext(NexaClientContext);
  if (!client) throw new Error("NeXa field client is not available.");
  return client;
}
