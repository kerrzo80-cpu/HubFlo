import type { HubDetailState } from "@/lib/hub-detail-store";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function eventId(value: unknown) {
  const record = asRecord(value);
  return typeof record?.id === "string" && record.id.trim() ? record.id.trim() : "";
}

function isProtectedDeliveryEvent(value: unknown) {
  const record = asRecord(value);
  if (!record) return false;
  const id = String(record.id || "");
  return (
    record.formType === "daywork" ||
    id.startsWith("daywork-") ||
    record.source === "Engineer app" ||
    record.source === "Field"
  );
}

/** Merge delivery events by id; keep Field/daywork events Core may not have loaded yet. */
export function mergeJobDeliveryEvents(serverValue: unknown, clientValue: unknown) {
  const server = Array.isArray(serverValue) ? serverValue : [];
  const client = Array.isArray(clientValue) ? clientValue : [];
  const byId = new Map<string, Record<string, unknown>>();

  for (const item of server) {
    const id = eventId(item);
    const record = asRecord(item);
    if (id && record) byId.set(id, record);
  }

  for (const item of client) {
    const id = eventId(item);
    const record = asRecord(item);
    if (!id || !record) continue;
    const existing = byId.get(id);
    byId.set(id, existing ? { ...existing, ...record } : record);
  }

  // Preserve protected server events that the client omitted (stale Core tab).
  for (const item of server) {
    const id = eventId(item);
    const record = asRecord(item);
    if (!id || !record || !isProtectedDeliveryEvent(record)) continue;
    if (!client.some((entry) => eventId(entry) === id)) {
      byId.set(id, record);
    }
  }

  return Array.from(byId.values());
}

function mergeStringKeyedRecords(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  return { ...server, ...client };
}

function mergeJobCostCentres(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  const jobIds = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: Record<string, unknown[]> = {};

  for (const jobId of jobIds) {
    const serverCentres = Array.isArray(server[jobId]) ? (server[jobId] as unknown[]) : [];
    const clientCentres = Array.isArray(client[jobId]) ? (client[jobId] as unknown[]) : [];
    const byId = new Map<string, Record<string, unknown>>();

    for (const item of serverCentres) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (id) byId.set(id, record!);
    }
    for (const item of clientCentres) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (!id || !record) continue;
      byId.set(id, { ...(byId.get(id) || {}), ...record });
    }
    // Keep daywork centres if Core payload dropped them.
    for (const item of serverCentres) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (!id || !record) continue;
      const isDaywork =
        id.includes("daywork") ||
        /daywork/i.test(String(record.name || "")) ||
        /daywork/i.test(String(record.templateName || ""));
      if (isDaywork && !clientCentres.some((entry) => asRecord(entry)?.id === id)) {
        byId.set(id, record);
      }
    }
    merged[jobId] = Array.from(byId.values());
  }

  return merged;
}

/**
 * Merge a Core client hub PUT onto the live server hub so Field/daywork writes
 * are not wiped by a stale browser tab.
 */
export function mergeHubDetailState(serverState: HubDetailState, clientState: HubDetailState): HubDetailState {
  return {
    ...serverState,
    ...clientState,
    flowStepEvidence: mergeStringKeyedRecords(serverState.flowStepEvidence, clientState.flowStepEvidence),
    flowStepCompletion: mergeStringKeyedRecords(serverState.flowStepCompletion, clientState.flowStepCompletion),
    jobDeliveryEvents: mergeJobDeliveryEvents(serverState.jobDeliveryEvents, clientState.jobDeliveryEvents),
    jobCostCentres: mergeJobCostCentres(serverState.jobCostCentres, clientState.jobCostCentres),
    jobVariationSections: mergeStringKeyedRecords(
      serverState.jobVariationSections,
      clientState.jobVariationSections,
    ),
  };
}
