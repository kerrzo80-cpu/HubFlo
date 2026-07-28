/**
 * Phase B — Simpro full-import run + checkpoint store.
 * Worker ticks advance checkpoints without tying progress to one browser request.
 */

import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type SimproImportStage =
  | "queued"
  | "customers"
  | "sites"
  | "quotes"
  | "jobs"
  | "attachments"
  | "reconcile"
  | "completed"
  | "paused"
  | "cancelled"
  | "failed";

export type SimproImportMode = "preview" | "full" | "incremental";

export type SimproImportCheckpoint = {
  stage: SimproImportStage;
  lastProcessedPage?: number;
  lastProcessedExternalId?: string;
  cursor?: string;
};

export type SimproImportCounts = {
  fetched: number;
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  conflicts: number;
  errors: number;
};

export type SimproImportError = {
  id: string;
  at: string;
  stage: SimproImportStage;
  entityType?: string;
  externalId?: string;
  message: string;
  detail?: string;
};

export type SimproImportRun = {
  id: string;
  mode: SimproImportMode;
  companyId: string;
  tenantKey: string;
  actor: string;
  status: SimproImportStage;
  checkpoint: SimproImportCheckpoint;
  counts: SimproImportCounts;
  options: {
    includeJobs: boolean;
    includeQuotes: boolean;
    includeArchived: boolean;
    includeAttachments: boolean;
    dateFrom?: string;
    dateTo?: string;
  };
  errors: SimproImportError[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  summary?: string;
};

type ImportRunStore = {
  runs: SimproImportRun[];
  activeRunId?: string;
};

const emptyCounts = (): SimproImportCounts => ({
  fetched: 0,
  created: 0,
  updated: 0,
  linked: 0,
  skipped: 0,
  conflicts: 0,
  errors: 0,
});

const store = loadServerStore<ImportRunStore>("simpro-import-runs", { runs: [] });

function persist() {
  writeServerStore("simpro-import-runs", store);
}

function cloneRun(run: SimproImportRun): SimproImportRun {
  return JSON.parse(JSON.stringify(run)) as SimproImportRun;
}

export function listSimproImportRuns(limit = 20) {
  return store.runs.slice(0, Math.max(1, limit)).map(cloneRun);
}

export function getSimproImportRun(id: string) {
  const run = store.runs.find((item) => item.id === id);
  return run ? cloneRun(run) : null;
}

export function getActiveSimproImportRun() {
  if (!store.activeRunId) return null;
  return getSimproImportRun(store.activeRunId);
}

export function createSimproImportRun(input: {
  mode: SimproImportMode;
  companyId: string;
  actor: string;
  tenantKey?: string;
  options?: Partial<SimproImportRun["options"]>;
}) {
  const active = getActiveSimproImportRun();
  if (active && !["completed", "cancelled", "failed"].includes(active.status)) {
    throw new Error(`Import already in progress (${active.id}, stage ${active.status})`);
  }

  const now = new Date().toISOString();
  const run: SimproImportRun = {
    id: `sir-${crypto.randomUUID()}`,
    mode: input.mode,
    companyId: input.companyId.trim(),
    tenantKey: input.tenantKey?.trim() || "default",
    actor: input.actor.trim() || "NeXa admin",
    status: "queued",
    checkpoint: { stage: "queued", lastProcessedPage: 0 },
    counts: emptyCounts(),
    options: {
      includeJobs: input.options?.includeJobs ?? true,
      includeQuotes: input.options?.includeQuotes ?? true,
      includeArchived: input.options?.includeArchived ?? false,
      includeAttachments: input.options?.includeAttachments ?? false,
      dateFrom: input.options?.dateFrom,
      dateTo: input.options?.dateTo,
    },
    errors: [],
    startedAt: now,
    updatedAt: now,
    summary: `${input.mode} import queued for company ${input.companyId}`,
  };

  store.runs = [run, ...store.runs].slice(0, 50);
  store.activeRunId = run.id;
  persist();
  return cloneRun(run);
}

export function updateSimproImportRun(
  id: string,
  patch: Partial<Pick<SimproImportRun, "status" | "checkpoint" | "counts" | "summary" | "finishedAt">> & {
    clearFinishedAt?: boolean;
    appendError?: Omit<SimproImportError, "id" | "at">;
  },
) {
  const index = store.runs.findIndex((item) => item.id === id);
  if (index < 0) return null;

  const current = store.runs[index];
  if (!current) return null;
  const now = new Date().toISOString();
  const next: SimproImportRun = {
    id: current.id,
    mode: current.mode,
    companyId: current.companyId,
    tenantKey: current.tenantKey,
    actor: current.actor,
    options: current.options,
    startedAt: current.startedAt,
    status: patch.status ?? current.status,
    checkpoint: patch.checkpoint ?? current.checkpoint,
    counts: patch.counts ?? current.counts,
    summary: patch.summary ?? current.summary,
    finishedAt: patch.clearFinishedAt ? undefined : (patch.finishedAt ?? current.finishedAt),
    updatedAt: now,
    errors: [...current.errors],
  };

  if (patch.appendError) {
    next.errors = [
      {
        id: `sie-${crypto.randomUUID()}`,
        at: now,
        ...patch.appendError,
      },
      ...next.errors,
    ].slice(0, 200);
    next.counts = { ...next.counts, errors: next.counts.errors + 1 };
  }

  if (["completed", "cancelled", "failed"].includes(next.status)) {
    next.finishedAt = next.finishedAt ?? now;
    if (store.activeRunId === id) store.activeRunId = undefined;
  }

  store.runs[index] = next;
  persist();
  return cloneRun(next);
}

export function controlSimproImportRun(id: string, action: "pause" | "resume" | "cancel") {
  const run = getSimproImportRun(id);
  if (!run) return null;

  if (action === "pause") {
    if (["completed", "cancelled", "failed", "paused"].includes(run.status)) return run;
    return updateSimproImportRun(id, {
      status: "paused",
      checkpoint: { ...run.checkpoint, stage: "paused" },
      summary: "Import paused",
    });
  }

  if (action === "resume") {
    if (run.status !== "paused") return run;
    const resumedStage = run.checkpoint.stage === "paused" ? "queued" : run.checkpoint.stage;
    store.activeRunId = id;
    persist();
    return updateSimproImportRun(id, {
      status: resumedStage === "queued" ? "queued" : resumedStage,
      checkpoint: { ...run.checkpoint, stage: resumedStage },
      summary: "Import resumed",
      clearFinishedAt: true,
    });
  }

  // cancel
  if (["completed", "cancelled"].includes(run.status)) return run;
  return updateSimproImportRun(id, {
    status: "cancelled",
    checkpoint: { ...run.checkpoint, stage: "cancelled" },
    summary: "Import cancelled",
  });
}

export function getSimproImportStatus() {
  const active = getActiveSimproImportRun();
  const recent = listSimproImportRuns(10);
  return {
    activeRun: active,
    recentRuns: recent,
    canStart: !active || ["completed", "cancelled", "failed"].includes(active.status),
  };
}
