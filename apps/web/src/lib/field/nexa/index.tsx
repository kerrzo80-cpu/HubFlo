"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createMockNexaClient } from "@/lib/field/nexa/client";
import type { NexaFieldClient } from "@/lib/field/types";

const NexaClientContext = createContext<NexaFieldClient | null>(null);

export function NexaClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createMockNexaClient(), []);
  return <NexaClientContext.Provider value={client}>{children}</NexaClientContext.Provider>;
}

export function useNexaClient() {
  const client = useContext(NexaClientContext);
  if (!client) throw new Error("NeXa field client is not available.");
  return client;
}
