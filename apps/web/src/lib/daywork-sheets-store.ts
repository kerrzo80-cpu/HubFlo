import { loadServerStore, writeServerStore } from "@/lib/server-store";
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

export function readDayworkSheetsStore(): DayworkSheetsStore {
  return clone(store);
}

export function writeDayworkSheetSnapshot(snapshot: DayworkSheetSnapshot) {
  const key = dayworkSheetKey(snapshot.jobId, snapshot.costCentreId);
  store[key] = clone(snapshot);
  writeServerStore("daywork-sheets-store", store);
  return clone(store[key]);
}

export function mergeDayworkSheetsIntoStore(incoming: unknown) {
  const merged = mergeSheets(store, incoming);
  Object.keys(store).forEach((key) => {
    delete store[key];
  });
  Object.assign(store, merged);
  writeServerStore("daywork-sheets-store", store);
  return clone(store);
}

export function listDayworkSheetsFromStore(jobId?: string): DayworkSheetSnapshot[] {
  const sheets = Object.values(store);
  if (!jobId) return clone(sheets);
  return clone(sheets.filter((sheet) => sheet.jobId === jobId));
}

export function getDayworkSheetFromStore(jobId: string, costCentreId: string): DayworkSheetSnapshot | null {
  const sheet = store[dayworkSheetKey(jobId, costCentreId)];
  return sheet ? clone(sheet) : null;
}
