import { statSync } from "node:fs";
import path from "node:path";

import {
  getServerStoreDirectory,
  getSqliteStorePath,
  readServerStoreSnapshot,
} from "@/lib/server-store";
import { getJobs, getQuotes, type Job, type Quote, type WorkflowStore } from "@/lib/workflow-data";

let cachedRevision = "";
let cachedJobs: Job[] | null = null;
let cachedQuotes: Quote[] | null = null;

function fileRevision(filePath: string) {
  try {
    const stat = statSync(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return `${filePath}:missing`;
  }
}

/**
 * Cheap cross-process freshness signal for the workflow store.
 *
 * Render can have more than one request/module instance touching the same persistent
 * SQLite store. We must not deserialize/clone the whole workflow store on every read
 * (that caused the 502/OOM regression), but Ayla must still see a job/quote written by
 * another request before resolving a natural-language reference.
 *
 * SQLite WAL metadata or JSON file metadata changes when the store changes. We only
 * deserialize the persisted workflow store when that lightweight revision changes.
 */
function workflowStoreRevision() {
  const sqlitePath = getSqliteStorePath();
  if (sqlitePath) {
    return `${fileRevision(sqlitePath)}|${fileRevision(`${sqlitePath}-wal`)}`;
  }
  return fileRevision(path.join(getServerStoreDirectory(), "workflow-store.json"));
}

function refreshCacheIfNeeded() {
  const revision = workflowStoreRevision();
  if (revision === cachedRevision && cachedJobs && cachedQuotes) return;

  const snapshot = readServerStoreSnapshot("workflow-store") as Partial<WorkflowStore> | null;
  if (snapshot && Array.isArray(snapshot.jobs) && Array.isArray(snapshot.quotes)) {
    cachedJobs = snapshot.jobs as Job[];
    cachedQuotes = snapshot.quotes as Quote[];
  } else {
    // Keep normal in-process behaviour when there is no persistent snapshot.
    cachedJobs = getJobs();
    cachedQuotes = getQuotes();
  }
  cachedRevision = revision;
}

export function getFreshJobsForHumanLookup() {
  refreshCacheIfNeeded();
  return cachedJobs ?? getJobs();
}

export function getFreshQuotesForHumanLookup() {
  refreshCacheIfNeeded();
  return cachedQuotes ?? getQuotes();
}
