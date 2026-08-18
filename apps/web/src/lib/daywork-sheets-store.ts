import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import type { DayworkSheetSnapshot } from "@/lib/daywork-account-form";
import { dayworkSheetKey } from "@/lib/daywork-account-form";

type DayworkSheetsStore = Record<string, DayworkSheetSnapshot>;

const store = loadServerStore<DayworkSheetsStore>("daywork-sheets-store", {});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeSheets(serverValue: unknown, clientValue: unknown): DayworkSheetsStore {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  const keys = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: DayworkSheetsStore = {};

  for (const key of keys) {
    const serverSheet = asRecord(server[key]) as DayworkSheetSnapshot | null;
    const clientSheet = asRecord(client[key]) as DayworkSheetSnapshot | null;
    if (!serverSheet) {
      if (clientSheet) merged[key] = clientSheet;
      continue;
    }
    if (!clientSheet) {
      merged[key] = serverSheet;
      continue;
    }
    const serverSigned = Boolean(
      String(serverSheet.plumberSignature || "").trim() && String(serverSheet.clientSignature || "").trim(),
    );
    const clientSigned = Boolean(
      String(clientSheet.plumberSignature || "").trim() && String(clientSheet.clientSignature || "").trim(),
    );
    if (serverSigned && !clientSigned) {
      merged[key] = {
        ...clientSheet,
        ...serverSheet,
        labourRate: clientSheet.labourRate || serverSheet.labourRate,
        materialsCost: clientSheet.materialsCost || serverSheet.materialsCost,
        plantCost: clientSheet.plantCost || serverSheet.plantCost,
        markupPercent: clientSheet.markupPercent || serverSheet.markupPercent,
        materialsJson: serverSheet.materialsJson || clientSheet.materialsJson,
        plantJson: serverSheet.plantJson || clientSheet.plantJson,
      };
      continue;
    }
    merged[key] = {
      ...serverSheet,
      ...clientSheet,
      description: clientSheet.description || serverSheet.description,
      weekEnding: clientSheet.weekEnding || serverSheet.weekEnding,
      labourName: clientSheet.labourName || serverSheet.labourName,
      labourTrade: clientSheet.labourTrade || serverSheet.labourTrade,
      labourDaysJson: clientSheet.labourDaysJson || serverSheet.labourDaysJson,
      labourHours: clientSheet.labourHours || serverSheet.labourHours,
      materialsJson: clientSheet.materialsJson || serverSheet.materialsJson,
      plantJson: clientSheet.plantJson || serverSheet.plantJson,
      plumberSignature: clientSheet.plumberSignature || serverSheet.plumberSignature,
      clientSignature: clientSheet.clientSignature || serverSheet.clientSignature,
      plumberSignerName: clientSheet.plumberSignerName || serverSheet.plumberSignerName,
      clientSignerName: clientSheet.clientSignerName || serverSheet.clientSignerName,
      labourRate: clientSheet.labourRate || serverSheet.labourRate,
      materialsCost: clientSheet.materialsCost || serverSheet.materialsCost,
      plantCost: clientSheet.plantCost || serverSheet.plantCost,
      markupPercent: clientSheet.markupPercent || serverSheet.markupPercent,
    };
  }
  return merged;
}

/** Re-read SQLite/disk into the module cache so multi-worker Field saves are visible to Core. */
function hydrateStoreFromDisk() {
  const disk = readServerStoreSnapshot("daywork-sheets-store");
  if (!disk || typeof disk !== "object" || Array.isArray(disk)) return;
  const merged = mergeSheets(store, disk);
  Object.keys(store).forEach((key) => {
    delete store[key];
  });
  Object.assign(store, merged);
}

export function readDayworkSheetsStore(): DayworkSheetsStore {
  hydrateStoreFromDisk();
  return clone(store);
}

export function writeDayworkSheetSnapshot(snapshot: DayworkSheetSnapshot) {
  hydrateStoreFromDisk();
  const key = dayworkSheetKey(snapshot.jobId, snapshot.costCentreId);
  store[key] = clone(snapshot);
  const ok = writeServerStore("daywork-sheets-store", store);
  if (!ok) {
    throw new Error("Could not persist Daywork sheet to the server store.");
  }
  // Prove the write by re-reading from disk (catches silent SQLite failures).
  hydrateStoreFromDisk();
  const verified = store[key];
  if (
    !verified ||
    !String(verified.plumberSignature || "").trim() ||
    !String(verified.clientSignature || "").trim()
  ) {
    throw new Error("Daywork sheet write did not verify — signatures missing after save.");
  }
  return clone(store[key]);
}

export function mergeDayworkSheetsIntoStore(incoming: unknown) {
  hydrateStoreFromDisk();
  const merged = mergeSheets(store, incoming);
  Object.keys(store).forEach((key) => {
    delete store[key];
  });
  Object.assign(store, merged);
  writeServerStore("daywork-sheets-store", store);
  return clone(store);
}

export function listDayworkSheetsFromStore(jobId?: string): DayworkSheetSnapshot[] {
  const sheets = Object.values(readDayworkSheetsStore());
  if (!jobId) return sheets;
  return sheets.filter((sheet) => sheet.jobId === jobId);
}

export function getDayworkSheetFromStore(jobId: string, costCentreId: string): DayworkSheetSnapshot | null {
  hydrateStoreFromDisk();
  const sheet = store[dayworkSheetKey(jobId, costCentreId)];
  return sheet ? clone(sheet) : null;
}

/** Remove an unsigned / discarded Daywork sheet from the durable store. */
export function deleteDayworkSheetFromStore(jobId: string, costCentreId: string): boolean {
  hydrateStoreFromDisk();
  const key = dayworkSheetKey(jobId, costCentreId);
  if (!store[key]) return false;
  delete store[key];
  writeServerStore("daywork-sheets-store", store);
  return true;
}

/** Prefer exact cost-centre match; otherwise any sheet for the job (newest signed first). */
export function findDayworkSheetForJob(
  sheets: Record<string, DayworkSheetSnapshot> | undefined | null,
  jobId: string,
  costCentreId?: string,
): DayworkSheetSnapshot | null {
  if (!sheets || typeof sheets !== "object") return null;
  if (costCentreId) {
    const exact = sheets[dayworkSheetKey(jobId, costCentreId)];
    if (exact) return exact;
  }
  const matches = Object.values(sheets).filter((sheet) => sheet?.jobId === jobId);
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const aSigned = Boolean(String(a.plumberSignature || "").trim() && String(a.clientSignature || "").trim());
    const bSigned = Boolean(String(b.plumberSignature || "").trim() && String(b.clientSignature || "").trim());
    if (aSigned !== bSigned) return aSigned ? -1 : 1;
    const aAt = Date.parse(String(a.updatedAt || a.completedAt || "")) || 0;
    const bAt = Date.parse(String(b.updatedAt || b.completedAt || "")) || 0;
    return bAt - aAt;
  });
  return matches[0] || null;
}
