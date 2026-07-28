/**
 * Phase C — core Simpro import orchestrator (header upserts + checkpoints).
 * One tick processes one page of the current stage (quotes or jobs).
 */

import { appendAuditEvent, getClients } from "@/lib/people-data";
import {
  extractSimproRecords,
  getSimproReadConfig,
  simproGet,
  simproRecordId,
  type UnknownRecord,
} from "@/lib/simpro-client";
import { upsertSimproEntityLink, findSimproEntityLink } from "@/lib/simpro-entity-links";
import {
  getActiveSimproImportRun,
  getSimproImportRun,
  updateSimproImportRun,
  type SimproImportCounts,
  type SimproImportRun,
  type SimproImportStage,
} from "@/lib/simpro-import-runs";
import {
  mapSimproJobHeader,
  mapSimproQuoteHeader,
  simproCustomerExternalId,
} from "@/lib/simpro-import-map";
import { createJob, createQuote, getJobs, getQuotes } from "@/lib/workflow-data";

const PAGE_SIZE = 50;

function nextStage(run: SimproImportRun, current: SimproImportStage): SimproImportStage {
  if (current === "queued") {
    if (run.options.includeQuotes) return "quotes";
    if (run.options.includeJobs) return "jobs";
    return "completed";
  }
  if (current === "quotes") {
    if (run.options.includeJobs) return "jobs";
    return "completed";
  }
  if (current === "jobs") return "completed";
  return "completed";
}

function bumpCounts(base: SimproImportCounts, patch: Partial<SimproImportCounts>): SimproImportCounts {
  return {
    fetched: base.fetched + (patch.fetched ?? 0),
    created: base.created + (patch.created ?? 0),
    updated: base.updated + (patch.updated ?? 0),
    linked: base.linked + (patch.linked ?? 0),
    skipped: base.skipped + (patch.skipped ?? 0),
    conflicts: base.conflicts + (patch.conflicts ?? 0),
    errors: base.errors + (patch.errors ?? 0),
  };
}

function resolveCustomerLink(companyId: string, record: UnknownRecord) {
  const externalId = simproCustomerExternalId(record);
  if (!externalId) return { customerName: undefined as string | undefined, clientId: undefined as string | undefined };
  const link = findSimproEntityLink({ companyId, entityType: "client", externalId });
  if (link) {
    return { customerName: link.nexaName, clientId: link.nexaId };
  }
  const byName = getClients().find((client) => {
    const name =
      (typeof record.Customer === "object" && record.Customer && !Array.isArray(record.Customer)
        ? String((record.Customer as UnknownRecord).CompanyName || (record.Customer as UnknownRecord).Name || "")
        : "") || "";
    return name && client.name.trim().toLowerCase() === name.trim().toLowerCase();
  });
  return { customerName: byName?.name, clientId: byName?.id };
}

async function fetchStagePage(stage: "quotes" | "jobs", page: number) {
  const config = await getSimproReadConfig();
  const path = `/${stage}?pageSize=${PAGE_SIZE}&page=${page}`;
  const result = await simproGet(config, path);
  const records = extractSimproRecords(result.body);
  return { config, result, records, page };
}

function importQuoteRecord(companyId: string, record: UnknownRecord, preview: boolean) {
  const externalId = simproRecordId(record);
  if (!externalId) return { action: "conflict" as const, message: "Quote missing Simpro ID" };

  const existingLink = findSimproEntityLink({ companyId, entityType: "quote", externalId });
  if (existingLink) {
    return { action: "skipped" as const, message: `Already linked to ${existingLink.nexaRef || existingLink.nexaId}` };
  }

  const existing = getQuotes().find((quote) => quote.simproQuoteId === externalId);
  if (existing) {
    if (!preview) {
      upsertSimproEntityLink({
        companyId,
        entityType: "quote",
        externalId,
        externalNumber: existing.ref,
        nexaId: existing.id,
        nexaRef: existing.ref,
        nexaName: existing.customer,
        importedReadOnly: true,
      });
    }
    return { action: "linked" as const, message: `Linked to existing ${existing.ref}` };
  }

  const customer = resolveCustomerLink(companyId, record);
  const mapped = mapSimproQuoteHeader(record, customer);
  if (!mapped) return { action: "conflict" as const, message: "Unable to map quote" };

  if (preview) {
    return { action: "created" as const, message: `Would create quote for ${mapped.customer}` };
  }

  const { externalId: _e, externalNumber, sourceModifiedAt: _s, ...payload } = mapped;
  const quote = createQuote(payload);
  upsertSimproEntityLink({
    companyId,
    entityType: "quote",
    externalId,
    externalNumber: externalNumber || quote.ref,
    nexaId: quote.id,
    nexaRef: quote.ref,
    nexaName: quote.customer,
    importedReadOnly: true,
    sourceModifiedAt: mapped.sourceModifiedAt,
  });
  appendAuditEvent({
    actor: "Simpro import",
    action: "created",
    recordType: "quote",
    recordId: quote.id,
    summary: `${quote.ref} imported from Simpro quote ${externalId}.`,
    source: "Simpro import",
    importance: "normal",
  });
  return { action: "created" as const, message: `Created ${quote.ref}` };
}

function importJobRecord(companyId: string, record: UnknownRecord, preview: boolean) {
  const externalId = simproRecordId(record);
  if (!externalId) return { action: "conflict" as const, message: "Job missing Simpro ID" };

  const existingLink = findSimproEntityLink({ companyId, entityType: "job", externalId });
  if (existingLink) {
    return { action: "skipped" as const, message: `Already linked to ${existingLink.nexaRef || existingLink.nexaId}` };
  }

  const existing = getJobs().find((job) => job.simproJobId === externalId);
  if (existing) {
    if (!preview) {
      upsertSimproEntityLink({
        companyId,
        entityType: "job",
        externalId,
        externalNumber: existing.ref,
        nexaId: existing.id,
        nexaRef: existing.ref,
        nexaName: existing.customer,
        importedReadOnly: true,
      });
    }
    return { action: "linked" as const, message: `Linked to existing ${existing.ref}` };
  }

  const customer = resolveCustomerLink(companyId, record);
  const mapped = mapSimproJobHeader(record, customer);
  if (!mapped) return { action: "conflict" as const, message: "Unable to map job" };

  if (preview) {
    return { action: "created" as const, message: `Would create job for ${mapped.customer}` };
  }

  const { externalId: _e, externalNumber, sourceModifiedAt: _s, ...payload } = mapped;
  const job = createJob(payload);
  upsertSimproEntityLink({
    companyId,
    entityType: "job",
    externalId,
    externalNumber: externalNumber || job.ref,
    nexaId: job.id,
    nexaRef: job.ref,
    nexaName: job.customer,
    importedReadOnly: true,
    sourceModifiedAt: mapped.sourceModifiedAt,
  });
  appendAuditEvent({
    actor: "Simpro import",
    action: "created",
    recordType: "job",
    recordId: job.id,
    summary: `${job.ref} imported from Simpro job ${externalId}.`,
    source: "Simpro import",
    importance: "normal",
  });
  return { action: "created" as const, message: `Created ${job.ref}` };
}

export async function tickSimproImport(runId?: string) {
  const run = runId ? getSimproImportRun(runId) : getActiveSimproImportRun();
  if (!run) throw new Error("No active Simpro import run.");
  if (["completed", "cancelled", "failed", "paused"].includes(run.status)) {
    return { run, progressed: false, note: `Run is ${run.status}` };
  }

  const preview = run.mode === "preview";
  let stage = run.status === "queued" ? nextStage(run, "queued") : run.status;
  if (stage !== "quotes" && stage !== "jobs") {
    const completed = updateSimproImportRun(run.id, {
      status: "completed",
      checkpoint: { stage: "completed", lastProcessedPage: run.checkpoint.lastProcessedPage },
      summary: "Import finished (no quote/job stages selected).",
    });
    return { run: completed, progressed: false, note: "Nothing to import" };
  }

  const page = (run.checkpoint.stage === stage ? (run.checkpoint.lastProcessedPage ?? 0) : 0) + 1;
  let counts = { ...run.counts };
  const operations: string[] = [];

  try {
    const { config, result, records } = await fetchStagePage(stage, page);
    if (!result.ok) {
      const failed = updateSimproImportRun(run.id, {
        status: "failed",
        appendError: {
          stage,
          message: `Simpro ${stage} page ${page} failed with HTTP ${result.status}`,
        },
        summary: `Import failed on ${stage} page ${page}`,
      });
      return { run: failed, progressed: false, note: `HTTP ${result.status}` };
    }

    counts = bumpCounts(counts, { fetched: records.length });
    for (const record of records) {
      try {
        const outcome =
          stage === "quotes"
            ? importQuoteRecord(config.companyId, record, preview)
            : importJobRecord(config.companyId, record, preview);
        if (outcome.action === "created") counts = bumpCounts(counts, { created: 1 });
        else if (outcome.action === "linked") counts = bumpCounts(counts, { linked: 1 });
        else if (outcome.action === "skipped") counts = bumpCounts(counts, { skipped: 1 });
        else counts = bumpCounts(counts, { conflicts: 1 });
        operations.push(outcome.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Record import failed";
        counts = bumpCounts(counts, { errors: 1 });
        updateSimproImportRun(run.id, {
          appendError: {
            stage,
            entityType: stage === "quotes" ? "quote" : "job",
            externalId: simproRecordId(record) || undefined,
            message,
          },
        });
      }
    }

    const lastId = records.length ? simproRecordId(records[records.length - 1]!) : run.checkpoint.lastProcessedExternalId;
    const morePages = records.length >= PAGE_SIZE;
    if (morePages) {
      const updated = updateSimproImportRun(run.id, {
        status: stage,
        counts,
        checkpoint: { stage, lastProcessedPage: page, lastProcessedExternalId: lastId },
        summary: `${preview ? "Previewed" : "Imported"} ${stage} page ${page} (${records.length} records).`,
      });
      return { run: updated, progressed: true, operations: operations.slice(0, 20), note: `Page ${page} done` };
    }

    const following = nextStage(run, stage);
    const updated = updateSimproImportRun(run.id, {
      status: following,
      counts,
      checkpoint: {
        stage: following,
        lastProcessedPage: following === stage ? page : 0,
        lastProcessedExternalId: lastId,
      },
      summary:
        following === "completed"
          ? `${preview ? "Preview" : "Import"} completed. Created ${counts.created}, linked ${counts.linked}, skipped ${counts.skipped}.`
          : `${stage} finished. Moving to ${following}.`,
      finishedAt: following === "completed" ? new Date().toISOString() : undefined,
    });
    return { run: updated, progressed: true, operations: operations.slice(0, 20), note: `Stage ${stage} complete` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import tick failed";
    const failed = updateSimproImportRun(run.id, {
      status: "failed",
      appendError: { stage, message },
      summary: message,
    });
    return { run: failed, progressed: false, note: message };
  }
}
