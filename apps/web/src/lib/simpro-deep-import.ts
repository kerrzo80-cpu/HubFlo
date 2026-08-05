/**
 * Deep Simpro pull — full quote/job hierarchy + schedules + invoices into NeXa hub state.
 * Called from Two-way sync Apply after header create/link.
 */

import { getSimproDirectConfigStatus } from "@/lib/simpro-auth";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import {
  asRecord,
  extractSimproRecords,
  getSimproReadConfig,
  simproGet,
  simproGetEntityDetail,
  simproGetFirstOk,
  simproRecordId,
  withSimproCompany,
  type UnknownRecord,
} from "@/lib/simpro-client";
import {
  mapSimproInvoice,
  mapSimproJobCostCentres,
  mapSimproJobSchedules,
  mapSimproQuoteCostCentres,
  scheduleBelongsToSimproJob,
  summariseHierarchyStats,
  type HierarchyStats,
  type MappedInvoice,
  type MappedJobCostCentre,
} from "@/lib/simpro-hierarchy-map";
import { findSimproEntityLink, upsertSimproEntityLink } from "@/lib/simpro-entity-links";
import { getJobs, getQuotes } from "@/lib/workflow-data";

export type DeepImportResult = {
  ok: boolean;
  summary: string;
  stats?: HierarchyStats;
  scheduleCount?: number;
  detail?: string;
  /** Full simPRO record after section/cost-centre hydration — used to patch NeXa headers. */
  record?: UnknownRecord;
};

function cloneRecordMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function cloneList(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function costCentersFromSection(section: UnknownRecord): UnknownRecord[] {
  if (Array.isArray(section.CostCenters)) {
    return section.CostCenters.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  }
  if (Array.isArray(section.CostCentres)) {
    return section.CostCentres.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  }
  return [];
}

function centreHasLineItems(centre: UnknownRecord): boolean {
  const items = asRecord(centre.Items) ?? centre;
  return [
    items.Labors,
    items.Labours,
    items.Labor,
    items.Labour,
    items.Catalogs,
    items.Catalogues,
    items.Catalogue,
    items.Materials,
    items.OneOffs,
    items.Oneoffs,
    items.Prebuilds,
    items.ServiceFees,
    items.Items,
  ].some((bag) => Array.isArray(bag) && bag.length > 0);
}

async function fetchPagedSimproList(
  config: Awaited<ReturnType<typeof getSimproReadConfig>>,
  basePath: string,
  options?: { pageSize?: number; maxPages?: number },
) {
  const pageSize = options?.pageSize ?? 250;
  const maxPages = options?.maxPages ?? 40;
  const collected: UnknownRecord[] = [];
  const seen = new Set<string>();
  const joiner = basePath.includes("?") ? "&" : "?";

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await simproGet(config, `${basePath}${joiner}pageSize=${pageSize}&page=${page}`, {
      maxRetries: 1,
    });
    if (!result.ok) break;
    const records = extractSimproRecords(result.body);
    for (const record of records) {
      const id = simproRecordId(record) || JSON.stringify(record);
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push(record);
    }
    const totalPages = Number(result.headers["result-pages"] || 0);
    if (records.length < pageSize) break;
    if (totalPages > 0 && page >= totalPages) break;
  }

  return collected;
}

async function fetchSectionCostCenters(
  config: Awaited<ReturnType<typeof getSimproReadConfig>>,
  entity: "quotes" | "jobs",
  externalId: string,
  sectionId: string,
) {
  const paths = [
    `/${entity}/${externalId}/sections/${sectionId}/costCenters/?display=all`,
    `/${entity}/${externalId}/sections/${sectionId}/costCenters/`,
    `/${entity}/${externalId}/sections/${sectionId}/costCentres/?display=all`,
    `/${entity}/${externalId}/sections/${sectionId}/costCentres/`,
  ];
  for (const path of paths) {
    const listed = await fetchPagedSimproList(config, path, { pageSize: 100, maxPages: 5 });
    if (listed.length) return listed;
  }
  return [];
}

const MAX_SECTIONS_PER_ENTITY = 25;
/** Prefer listing CCs over per-CC detail storms — detail is only for the first few empty ones. */
const MAX_CC_DETAIL_FETCHES_PER_ENTITY = 8;

export async function fetchFullEntity(
  entity: "quotes" | "jobs",
  externalId: string,
  prefetchedRecord?: UnknownRecord | null,
) {
  const baseConfig = await getSimproReadConfig();
  let config = baseConfig;
  let record = prefetchedRecord ? asRecord(prefetchedRecord) : null;

  // Ignore thin/incomplete prefetch — same trap as quote Apply caching a detail
  // without Customer/Site and then skipping the real display=all pull jobs/schedules use.
  if (record) {
    const hasCustomer =
      Boolean(asRecord(record.Customer)?.ID) ||
      typeof record.Customer === "number" ||
      typeof record.Customer === "string" ||
      Boolean(asRecord(record.Customer)?.CompanyName) ||
      Boolean(asRecord(record.Customer)?.Name);
    const hasSite =
      Boolean(asRecord(record.Site)?.ID) ||
      typeof record.Site === "number" ||
      typeof record.Site === "string" ||
      Boolean(asRecord(record.Site)?.Address) ||
      Boolean(asRecord(record.Site)?.Name);
    if (!hasCustomer && !hasSite) {
      record = null;
    }
  }

  if (!record) {
    const result = await simproGetEntityDetail(baseConfig, entity, externalId, { maxRetries: 2 });
    if (!result.ok) {
      const tried = result.attempts
        .slice(0, 6)
        .map((attempt) => `co${attempt.companyId}:${attempt.path}→${attempt.status}`)
        .join(", ");
      throw new Error(
        `Simpro ${entity.slice(0, -1)} ${externalId} detail failed (HTTP ${result.status}${tried ? `; tried ${tried}` : ""}).`,
      );
    }
    record = asRecord(result.body);
    config = withSimproCompany(baseConfig, result.companyId);
  }
  if (!record) throw new Error(`Simpro ${entity.slice(0, -1)} ${externalId} returned an empty body.`);

  let sections = Array.isArray(record.Sections)
    ? record.Sections.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
    : [];

  if (!sections.length) {
    sections = await fetchPagedSimproList(config, `/${entity}/${externalId}/sections/`, {
      pageSize: 100,
      maxPages: 5,
    });
  }

  // Cap hierarchy fan-out so one huge quote cannot OOM the sync route.
  sections = sections.slice(0, MAX_SECTIONS_PER_ENTITY);

  let ccDetailFetches = 0;
  const hydrated: UnknownRecord[] = [];
  for (const section of sections) {
    const sectionId = simproRecordId(section);
    let costCenters = costCentersFromSection(section);

    // Always list-fetch when nested CCs are missing/empty (matches bridge push path / scheduler).
    if (sectionId && !costCenters.length) {
      costCenters = await fetchSectionCostCenters(config, entity, externalId, sectionId);
    } else if (
      sectionId &&
      costCenters.every((centre) => !centreHasLineItems(centre) && !String(centre.Description || "").trim())
    ) {
      const listed = await fetchSectionCostCenters(config, entity, externalId, sectionId);
      if (listed.length) costCenters = listed;
    }

    const detailedCenters: UnknownRecord[] = [];
    for (const centre of costCenters) {
      const ccId = simproRecordId(centre);
      if (!centreHasLineItems(centre) && sectionId && ccId && ccDetailFetches < MAX_CC_DETAIL_FETCHES_PER_ENTITY) {
        ccDetailFetches += 1;
        const detail = await simproGetFirstOk(config, [
          `/${entity}/${externalId}/sections/${sectionId}/costCenters/${ccId}?display=all`,
          `/${entity}/${externalId}/sections/${sectionId}/costCenters/${ccId}`,
          `/${entity}/${externalId}/sections/${sectionId}/costCenters/${ccId}/?display=all`,
          `/${entity}/${externalId}/sections/${sectionId}/costCenters/${ccId}/`,
          `/${entity}/${externalId}/sections/${sectionId}/costCentres/${ccId}?display=all`,
          `/${entity}/${externalId}/sections/${sectionId}/costCentres/${ccId}`,
          `/${entity}/${externalId}/sections/${sectionId}/costCentres/${ccId}/?display=all`,
          `/${entity}/${externalId}/sections/${sectionId}/costCentres/${ccId}/`,
        ]);
        if (detail.ok) {
          const body = asRecord(detail.body);
          if (body) {
            detailedCenters.push({ ...centre, ...body });
            continue;
          }
        }
      }
      detailedCenters.push(centre);
    }

    hydrated.push({ ...section, CostCenters: detailedCenters });
  }

  record.Sections = hydrated;
  return { config, record };
}

async function fetchSchedulePages(
  config: Awaited<ReturnType<typeof getSimproReadConfig>>,
  query: string,
  options?: { maxPages?: number; pageSize?: number },
) {
  const pageSize = options?.pageSize ?? 250;
  const maxPages = options?.maxPages ?? 80;
  const collected: UnknownRecord[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page += 1) {
    const path = query.startsWith("/")
      ? `${query}${query.includes("?") ? "&" : "?"}pageSize=${pageSize}&page=${page}`
      : `/schedules/?pageSize=${pageSize}&page=${page}${query ? `&${query}` : ""}`;
    const result = await simproGet(config, path, { maxRetries: 1 });
    if (!result.ok) break;
    const records = extractSimproRecords(result.body);
    for (const record of records) {
      const id = simproRecordId(record) || JSON.stringify(record);
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push(record);
    }
    const totalPages = Number(result.headers["result-pages"] || 0);
    if (records.length < pageSize) break;
    if (totalPages > 0 && page >= totalPages) break;
  }

  return collected;
}

async function fetchSchedulesViaJobCostCentres(
  config: Awaited<ReturnType<typeof getSimproReadConfig>>,
  simproJobId: string,
  centres: MappedJobCostCentre[],
) {
  const collected: UnknownRecord[] = [];
  const seen = new Set<string>();

  const slots: Array<{ sectionId: string; costCentreId: string }> = [];
  for (const centre of centres) {
    if (centre.simproSectionId && centre.simproCostCentreId) {
      slots.push({ sectionId: centre.simproSectionId, costCentreId: centre.simproCostCentreId });
    }
  }

  if (!slots.length) {
    const detailed = await simproGet(config, `/jobs/${simproJobId}/?display=all`, { maxRetries: 1 });
    if (detailed.ok) {
      const record = asRecord(detailed.body) ?? {};
      const sections = Array.isArray(record.Sections)
        ? record.Sections.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
        : [];
      for (const section of sections) {
        const sectionId = simproRecordId(section);
        if (!sectionId) continue;
        const costCenters = Array.isArray(section.CostCenters)
          ? section.CostCenters.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
          : [];
        for (const costCenter of costCenters) {
          const costCentreId = simproRecordId(costCenter);
          if (!costCentreId) continue;
          slots.push({ sectionId, costCentreId });
        }
      }
    }
  }

  for (const slot of slots) {
    const path = `/jobs/${simproJobId}/sections/${slot.sectionId}/costCenters/${slot.costCentreId}/schedules/`;
    const pages = await fetchSchedulePages(config, path, { pageSize: 250, maxPages: 40 });
    for (const record of pages) {
      const id = simproRecordId(record) || JSON.stringify(record);
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push(record);
    }
  }

  return collected;
}

async function fetchJobSchedules(simproJobId: string, centres: MappedJobCostCentre[] = []) {
  const config = await getSimproReadConfig();
  const candidates = [
    `Reference=${encodeURIComponent(`${simproJobId}%`)}`,
    `JobID=${encodeURIComponent(simproJobId)}`,
    `search=all&Reference=${encodeURIComponent(`${simproJobId}-`)}`,
  ];

  const byId = new Map<string, UnknownRecord>();
  for (const query of candidates) {
    const pages = await fetchSchedulePages(config, query);
    const matched = pages.filter((row) => scheduleBelongsToSimproJob(row, simproJobId));
    for (const record of matched) {
      const id = simproRecordId(record) || JSON.stringify(record);
      byId.set(id, record);
    }
    // Keep trying other filters — some tenants only answer one shape.
  }

  if (byId.size === 0 || centres.length > 0) {
    const nested = await fetchSchedulesViaJobCostCentres(config, simproJobId, centres);
    for (const record of nested) {
      const id = simproRecordId(record) || JSON.stringify(record);
      byId.set(id, record);
    }
  }

  return Array.from(byId.values());
}

async function fetchInvoiceDetail(externalId: string) {
  const config = await getSimproReadConfig();
  const result = await simproGetFirstOk(config, [
    `/invoices/${externalId}/?display=all`,
    `/invoices/${externalId}/`,
  ]);
  if (!result.ok) {
    throw new Error(`Simpro invoice ${externalId} detail failed (HTTP ${result.status}).`);
  }
  return asRecord(result.body) ?? {};
}

export async function enrichNexaQuoteFromSimpro(input: {
  nexaQuoteId: string;
  simproQuoteId: string;
  companyId?: string;
  /** Skip the duplicate /quotes/{id}?display=all when Apply already hydrated the header. */
  prefetchedRecord?: UnknownRecord | null;
}): Promise<DeepImportResult> {
  try {
    const { config, record } = await fetchFullEntity("quotes", input.simproQuoteId, input.prefetchedRecord);
    const companyId = input.companyId || config.companyId;
    const { centres, stats } = mapSimproQuoteCostCentres(record, input.nexaQuoteId);

    const hub = getHubDetailState();
    const quoteCostCentres = cloneRecordMap(hub.quoteCostCentres);
    const quoteSections = cloneRecordMap(hub.quoteSections);

    const sectionMap = new Map<string, { id: string; name: string; description: string }>();
    for (const centre of centres) {
      if (centre.sectionId) {
        sectionMap.set(centre.sectionId, {
          id: centre.sectionId,
          name: centre.sectionName || centre.name || "Imported section",
          description: centre.clientDescription || centre.engineerDescription || "Imported from simPRO",
        });
      }
      if (companyId && centre.simproCostCentreId) {
        upsertSimproEntityLink({
          companyId,
          entityType: "costCentre",
          externalId: centre.simproCostCentreId,
          nexaId: centre.id,
          nexaRef: centre.name,
          nexaName: centre.name,
          importedReadOnly: true,
        });
      }
    }

    quoteCostCentres[input.nexaQuoteId] = centres;
    quoteSections[input.nexaQuoteId] = Array.from(sectionMap.values());
    saveHubDetailState({
      ...hub,
      quoteCostCentres,
      quoteSections,
    });

    const emptyHierarchy =
      stats.costCentres === 0
        ? stats.sections > 0
          ? " Sections found but 0 cost centres mapped — check simPRO hierarchy."
          : " No sections/cost centres returned from simPRO."
        : "";

    return {
      ok: true,
      summary: `${summariseHierarchyStats(stats)}${emptyHierarchy}`,
      stats,
      detail: emptyHierarchy.trim() || undefined,
      record,
    };
  } catch (error) {
    return {
      ok: false,
      summary: "Cost centre pull failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function enrichNexaJobFromSimpro(input: {
  nexaJobId: string;
  simproJobId: string;
  companyId?: string;
  includeSchedules?: boolean;
  /** Skip the duplicate /jobs/{id}?display=all when Apply already hydrated the header. */
  prefetchedRecord?: UnknownRecord | null;
}): Promise<DeepImportResult> {
  try {
    const { config, record } = await fetchFullEntity("jobs", input.simproJobId, input.prefetchedRecord);
    const companyId = input.companyId || config.companyId;
    const { centres, stats } = mapSimproJobCostCentres(record, input.nexaJobId);

    let scheduleCount = 0;
    let schedules = mapSimproJobSchedules([], input.nexaJobId, centres);
    if (input.includeSchedules !== false) {
      const scheduleRecords = await fetchJobSchedules(input.simproJobId, centres);
      schedules = mapSimproJobSchedules(scheduleRecords, input.nexaJobId, centres);
      scheduleCount = schedules.length;
    }

    const hub = getHubDetailState();
    const jobCostCentres = cloneRecordMap(hub.jobCostCentres);
    const jobSections = cloneRecordMap(hub.jobSections);
    const jobSchedulePlans = cloneRecordMap(hub.jobSchedulePlans);

    const sectionMap = new Map<string, { id: string; name: string; description: string }>();
    for (const centre of centres) {
      if (centre.sectionId) {
        sectionMap.set(centre.sectionId, {
          id: centre.sectionId,
          name: centre.name,
          description: centre.clientDescription || centre.engineerDescription || "Imported from simPRO",
        });
      }
      if (companyId && centre.simproCostCentreId) {
        upsertSimproEntityLink({
          companyId,
          entityType: "costCentre",
          externalId: centre.simproCostCentreId,
          nexaId: centre.id,
          nexaRef: centre.name,
          nexaName: centre.name,
          importedReadOnly: true,
        });
      }
    }

    jobCostCentres[input.nexaJobId] = centres;
    jobSections[input.nexaJobId] = Array.from(sectionMap.values());
    if (input.includeSchedules !== false) {
      jobSchedulePlans[input.nexaJobId] = schedules;
    }

    saveHubDetailState({
      ...hub,
      jobCostCentres,
      jobSections,
      jobSchedulePlans,
    });

    const scheduleNote =
      input.includeSchedules === false
        ? ""
        : scheduleCount
          ? ` · ${scheduleCount} schedule${scheduleCount === 1 ? "" : "s"}`
          : " · no schedules found";

    const emptyHierarchy =
      stats.costCentres === 0
        ? stats.sections > 0
          ? " Sections found but 0 cost centres mapped — check simPRO hierarchy."
          : " No sections/cost centres returned from simPRO."
        : "";

    return {
      ok: true,
      summary: `${summariseHierarchyStats(stats)}${scheduleNote}${emptyHierarchy}`,
      stats,
      scheduleCount,
      detail: emptyHierarchy.trim() || undefined,
      record,
    };
  } catch (error) {
    return {
      ok: false,
      summary: "Job cost centre / schedule pull failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function centresFromHub(jobId: string): MappedJobCostCentre[] {
  const hub = getHubDetailState();
  const raw = cloneRecordMap(hub.jobCostCentres)[jobId];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => Boolean(item))
    .map((centre) => ({
      id: String(centre.id || ""),
      name: String(centre.name || "Cost centre"),
      sectionId: typeof centre.sectionId === "string" ? centre.sectionId : undefined,
      templateName: typeof centre.templateName === "string" ? centre.templateName : undefined,
      clientDescription: String(centre.clientDescription || ""),
      engineerDescription: String(centre.engineerDescription || ""),
      materials: Array.isArray(centre.materials) ? (centre.materials as MappedJobCostCentre["materials"]) : [],
      labour: Array.isArray(centre.labour) ? (centre.labour as MappedJobCostCentre["labour"]) : [],
      simproSectionId: typeof centre.simproSectionId === "string" ? centre.simproSectionId : undefined,
      simproCostCentreId: typeof centre.simproCostCentreId === "string" ? centre.simproCostCentreId : undefined,
    }))
    .filter((centre) => centre.id);
}

/**
 * Pull simPRO diary schedules into NeXa planner for every linked job.
 * Use when you only need schedules (jobs already exist in NeXa).
 */
export async function pullSchedulesForLinkedJobs(input?: {
  preview?: boolean;
  limit?: number;
}): Promise<{
  operations: Array<{
    action: "create" | "preview" | "skip" | "error";
    summary: string;
    nexaId?: string;
    nexaRef?: string;
    simproId?: string;
  }>;
  scheduleCount: number;
  jobCount: number;
}> {
  const preview = Boolean(input?.preview);
  const limit = Math.max(1, input?.limit ?? 500);
  const linkedJobs = getJobs()
    .filter((job) => Boolean(job.simproJobId?.trim()))
    .slice(0, limit);

  const operations: Array<{
    action: "create" | "preview" | "skip" | "error";
    summary: string;
    nexaId?: string;
    nexaRef?: string;
    simproId?: string;
  }> = [];
  let scheduleCount = 0;

  if (!linkedJobs.length) {
    operations.push({
      action: "skip",
      summary: "No NeXa jobs linked to simPRO yet. Import jobs first, then pull schedules.",
    });
    return { operations, scheduleCount: 0, jobCount: 0 };
  }

  const hub = getHubDetailState();
  const jobSchedulePlans = cloneRecordMap(hub.jobSchedulePlans);

  for (const job of linkedJobs) {
    const simproJobId = String(job.simproJobId || "").trim();
    if (!simproJobId) continue;
    try {
      const centres = centresFromHub(job.id);
      const scheduleRecords = await fetchJobSchedules(simproJobId, centres);
      const assignments = mapSimproJobSchedules(scheduleRecords, job.id, centres);
      if (preview) {
        operations.push({
          action: "preview",
          summary: `Would pull ${assignments.length} schedule${assignments.length === 1 ? "" : "s"} onto ${job.ref}.`,
          nexaId: job.id,
          nexaRef: job.ref,
          simproId: simproJobId,
        });
      } else {
        jobSchedulePlans[job.id] = assignments;
        operations.push({
          action: "create",
          summary: `Pulled ${assignments.length} schedule${assignments.length === 1 ? "" : "s"} onto ${job.ref}.`,
          nexaId: job.id,
          nexaRef: job.ref,
          simproId: simproJobId,
        });
      }
      scheduleCount += assignments.length;
    } catch (error) {
      operations.push({
        action: "error",
        summary: error instanceof Error ? error.message : `Unable to pull schedules for ${job.ref}.`,
        nexaId: job.id,
        nexaRef: job.ref,
        simproId: simproJobId,
      });
    }
  }

  if (!preview) {
    saveHubDetailState({
      ...hub,
      jobSchedulePlans,
    });
  }

  return { operations, scheduleCount, jobCount: linkedJobs.length };
}

function resolveInvoiceSource(mapped: MappedInvoice) {
  if (mapped.simproJobId) {
    const job =
      getJobs().find((item) => item.simproJobId === mapped.simproJobId) ||
      (() => {
        const link = findSimproEntityLink({
          companyId: getSimproReadConfigStatusCompanyId(),
          entityType: "job",
          externalId: mapped.simproJobId!,
        });
        return link ? getJobs().find((item) => item.id === link.nexaId) : undefined;
      })();
    if (job) {
      return {
        sourceType: "job" as const,
        sourceId: job.id,
        sourceRef: job.ref,
        sourceName: `Job ${job.ref}`,
        clientId: job.clientId,
        siteId: job.siteId,
        customer: job.customer || mapped.customer,
      };
    }
  }

  if (mapped.simproQuoteId) {
    const quote =
      getQuotes().find((item) => item.simproQuoteId === mapped.simproQuoteId) ||
      (() => {
        const link = findSimproEntityLink({
          companyId: getSimproReadConfigStatusCompanyId(),
          entityType: "quote",
          externalId: mapped.simproQuoteId!,
        });
        return link ? getQuotes().find((item) => item.id === link.nexaId) : undefined;
      })();
    if (quote) {
      return {
        sourceType: "quote" as const,
        sourceId: quote.id,
        sourceRef: quote.ref,
        sourceName: `Quote ${quote.ref}`,
        clientId: quote.clientId,
        siteId: quote.siteId,
        customer: quote.customer || mapped.customer,
      };
    }
  }

  return {
    sourceType: "job" as const,
    sourceId: mapped.simproJobId ? `simpro-job-${mapped.simproJobId}` : `simpro-invoice-${mapped.externalId}`,
    sourceRef: mapped.simproJobId ? `SIMPRO-J-${mapped.simproJobId}` : mapped.externalNumber || mapped.externalId,
    sourceName: mapped.title,
    customer: mapped.customer,
  };
}

function getSimproReadConfigStatusCompanyId() {
  return getSimproDirectConfigStatus().companyId || "0";
}

export async function importSimproInvoiceIntoHub(input: {
  record: UnknownRecord;
  companyId?: string;
  preview?: boolean;
}): Promise<{
  action: "create" | "link" | "skip" | "preview" | "conflict" | "error";
  summary: string;
  nexaId?: string;
  nexaRef?: string;
  simproId?: string;
}> {
  const listMapped = mapSimproInvoice(input.record);
  if (!listMapped) {
    return { action: "conflict", summary: "simPRO invoice has no stable ID." };
  }

  const hub = getHubDetailState();
  const invoices = cloneList(hub.invoices) as Array<Record<string, unknown>>;
  const existing = invoices.find(
    (invoice) =>
      String(invoice.simproInvoiceId || "") === listMapped.externalId ||
      String(invoice.xeroInvoiceNumber || "") === listMapped.externalNumber ||
      (listMapped.externalNumber && String(invoice.ref || "") === listMapped.externalNumber),
  );

  if (existing) {
    const nexaId = String(existing.id || "");
    const nexaRef = String(existing.ref || listMapped.externalNumber || "");
    if (!input.preview && input.companyId) {
      upsertSimproEntityLink({
        companyId: input.companyId,
        entityType: "invoice",
        externalId: listMapped.externalId,
        externalNumber: listMapped.externalNumber,
        nexaId,
        nexaRef,
        nexaName: String(existing.customer || listMapped.customer),
        importedReadOnly: true,
        sourceModifiedAt: listMapped.sourceModifiedAt,
      });
    }
    return {
      action: input.preview ? "preview" : "link",
      summary: input.preview
        ? `Would link invoice ${listMapped.externalNumber} to existing ${nexaRef}.`
        : `Linked invoice ${listMapped.externalNumber} to ${nexaRef}.`,
      nexaId,
      nexaRef,
      simproId: listMapped.externalId,
    };
  }

  if (input.preview) {
    return {
      action: "preview",
      summary: `Would import invoice ${listMapped.externalNumber} (${listMapped.lines.length} line${listMapped.lines.length === 1 ? "" : "s"}, £${listMapped.chargeTotal.toFixed(2)}).`,
      simproId: listMapped.externalId,
    };
  }

  let mapped = listMapped;
  try {
    const detail = await fetchInvoiceDetail(listMapped.externalId);
    const detailed = mapSimproInvoice({
      ...detail,
      ID: detail.ID ?? listMapped.externalId,
    });
    if (detailed) mapped = detailed;
  } catch {
    // List payload is enough for a usable invoice when detail fails.
  }

  const source = resolveInvoiceSource(mapped);
  const id = `inv-simpro-${mapped.externalId}`;
  const ref = mapped.externalNumber || `INV-SIMPRO-${mapped.externalId}`;
  const invoice = {
    id,
    ref,
    status: mapped.status,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceRef: source.sourceRef,
    sourceName: source.sourceName,
    customer: source.customer,
    issuedDate: mapped.issuedDate,
    dueDate: mapped.dueDate,
    clientId: "clientId" in source ? source.clientId : undefined,
    siteId: "siteId" in source ? source.siteId : undefined,
    title: mapped.title,
    lines: mapped.lines,
    costTotal: mapped.costTotal,
    chargeTotal: mapped.chargeTotal,
    vatRate: 20,
    notes: mapped.notes,
    simproInvoiceId: mapped.externalId,
    paymentStatus: mapped.status === "Paid" ? "Paid" : mapped.status === "Partially paid" ? "Part paid" : "Unpaid",
  };

  invoices.unshift(invoice);
  saveHubDetailState({
    ...hub,
    invoices,
  });

  if (input.companyId) {
    upsertSimproEntityLink({
      companyId: input.companyId,
      entityType: "invoice",
      externalId: mapped.externalId,
      externalNumber: mapped.externalNumber,
      nexaId: id,
      nexaRef: ref,
      nexaName: mapped.customer,
      importedReadOnly: true,
      sourceModifiedAt: mapped.sourceModifiedAt,
    });
  }

  return {
    action: "create",
    summary: `Created ${ref} from simPRO (${mapped.lines.length} lines, £${mapped.chargeTotal.toFixed(2)}).`,
    nexaId: id,
    nexaRef: ref,
    simproId: mapped.externalId,
  };
}
