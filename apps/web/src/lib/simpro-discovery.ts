/**
 * Phase A — Simpro API discovery.
 * Pulls sample jobs/quotes and one full hierarchy each for mapping.
 * Saves sanitised fixtures server-side. Never returns tokens to the client.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sanitizeSimproPayload, summarizeSimproShape } from "@hubflo/domain";
import {
  extractSimproRecords,
  getSimproReadConfig,
  simproGet,
  simproGetAbsolute,
  simproGetFirstOk,
  simproRecordId,
  type SimproFetchResult,
} from "@/lib/simpro-client";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

type UnknownRecord = Record<string, unknown>;

export type SimproDiscoveryProbe = {
  label: string;
  path: string;
  endpoint: string;
  status: number;
  ok: boolean;
  recordCount?: number;
  recordId?: string;
  shape?: unknown;
  error?: string;
};

export type SimproDiscoveryResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  companyId: string;
  baseUrlHost: string;
  probes: SimproDiscoveryProbe[];
  fixturesSaved: string[];
  summary: {
    jobsSampled: number;
    quotesSampled: number;
    fullJobId?: string;
    fullQuoteId?: string;
    jobSections: number;
    quoteSections: number;
    jobCostCentres: number;
    quoteCostCentres: number;
    jobItemCollections: string[];
    quoteItemCollections: string[];
  };
  errors: string[];
};

type DiscoveryStore = {
  lastRun?: SimproDiscoveryResult;
};

const discoveryStore = loadServerStore<DiscoveryStore>("simpro-discovery-store", {});

const ITEM_COLLECTION_CANDIDATES = [
  "labours",
  "laborItems",
  "labourItems",
  "catalogue",
  "catalogItems",
  "materials",
  "oneOffs",
  "oneoffs",
  "serviceFees",
  "prebuilds",
  "takeoffs",
  "subcontractorItems",
  "items",
];

function hostOnly(baseUrl: string) {
  try {
    return new URL(baseUrl.replace(/\/api\/v1\.0$/i, "")).host;
  } catch {
    return baseUrl;
  }
}

function fixtureDir() {
  const root =
    process.env.SIMPRO_DISCOVERY_FIXTURE_DIR?.trim() ||
    process.env.NEXA_STORE_DIR?.trim() ||
    join(process.cwd(), ".hubflo-runtime");
  const dir = join(root, "simpro-discovery-fixtures");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function saveFixture(name: string, payload: unknown) {
  const file = join(fixtureDir(), `${name}.json`);
  const sanitised = sanitizeSimproPayload(payload);
  writeFileSync(file, `${JSON.stringify(sanitised, null, 2)}\n`, "utf8");
  return file;
}

function probeFromResult(label: string, path: string, result: SimproFetchResult, extras?: Partial<SimproDiscoveryProbe>): SimproDiscoveryProbe {
  return {
    label,
    path,
    endpoint: result.endpoint,
    status: result.status,
    ok: result.ok,
    ...extras,
  };
}

async function listSample(config: Awaited<ReturnType<typeof getSimproReadConfig>>, entity: "jobs" | "quotes", pageSize = 5) {
  const path = `/${entity}/?pageSize=${pageSize}&orderby=-DateModified`;
  const result = await simproGet(config, path);
  const records = extractSimproRecords(result.body);
  return { result, records, path };
}

async function fetchFullRecord(config: Awaited<ReturnType<typeof getSimproReadConfig>>, entity: "jobs" | "quotes", id: string) {
  return simproGetFirstOk(config, [
    `/${entity}/${id}/?display=all`,
    `/${entity}/${id}/`,
  ]);
}

async function fetchSections(config: Awaited<ReturnType<typeof getSimproReadConfig>>, entity: "jobs" | "quotes", id: string) {
  const result = await simproGet(config, `/${entity}/${id}/sections/?pageSize=50`);
  return { result, records: extractSimproRecords(result.body) };
}

async function fetchCostCentres(
  config: Awaited<ReturnType<typeof getSimproReadConfig>>,
  entity: "jobs" | "quotes",
  recordId: string,
  sectionId: string,
) {
  const result = await simproGet(
    config,
    `/${entity}/${recordId}/sections/${sectionId}/costCenters/?pageSize=50`,
  );
  return { result, records: extractSimproRecords(result.body) };
}

async function probeItemCollections(
  config: Awaited<ReturnType<typeof getSimproReadConfig>>,
  entity: "jobs" | "quotes",
  recordId: string,
  sectionId: string,
  costCentreId: string,
) {
  const found: Array<{ name: string; count: number; path: string; body: unknown }> = [];
  const base = `/${entity}/${recordId}/sections/${sectionId}/costCenters/${costCentreId}`;
  for (const name of ITEM_COLLECTION_CANDIDATES) {
    const path = `${base}/${name}/?pageSize=50`;
    const result = await simproGet(config, path, { maxRetries: 1 });
    if (!result.ok) continue;
    const records = extractSimproRecords(result.body);
    found.push({ name, count: records.length, path, body: result.body });
  }

  // Also try notes / customFields / attachments at record level once per entity elsewhere.
  return found;
}

async function probeRelated(
  config: Awaited<ReturnType<typeof getSimproReadConfig>>,
  entity: "jobs" | "quotes",
  id: string,
) {
  const relatedPaths = [
    { label: `${entity}-notes`, path: `/${entity}/${id}/notes/?pageSize=20` },
    { label: `${entity}-custom-fields`, path: `/${entity}/${id}/customFields/?pageSize=50` },
    { label: `${entity}-attachments`, path: `/${entity}/${id}/attachments/?pageSize=20` },
    { label: `${entity}-attachments-files`, path: `/${entity}/${id}/attachments/files/?pageSize=20` },
  ];
  const out: Array<{ label: string; result: SimproFetchResult; records: UnknownRecord[] }> = [];
  for (const item of relatedPaths) {
    const result = await simproGet(config, item.path, { maxRetries: 1 });
    out.push({ label: item.label, result, records: extractSimproRecords(result.body) });
  }
  return out;
}

export function getLastSimproDiscovery() {
  return discoveryStore.lastRun ?? null;
}

export async function runSimproDiscovery(actor = "Blake admin"): Promise<SimproDiscoveryResult> {
  const startedAt = new Date().toISOString();
  const probes: SimproDiscoveryProbe[] = [];
  const fixturesSaved: string[] = [];
  const errors: string[] = [];
  const summary: SimproDiscoveryResult["summary"] = {
    jobsSampled: 0,
    quotesSampled: 0,
    jobSections: 0,
    quoteSections: 0,
    jobCostCentres: 0,
    quoteCostCentres: 0,
    jobItemCollections: [],
    quoteItemCollections: [],
  };

  const config = await getSimproReadConfig();
  const baseUrlHost = hostOnly(config.baseUrl);

  // Company / build info (host-level + company ping)
  const companies = await simproGetAbsolute(config, "/api/v1.0/companies/", { maxRetries: 1 });
  probes.push(
    probeFromResult("companies-list", "/api/v1.0/companies/", companies, {
      recordCount: extractSimproRecords(companies.body).length,
      shape: summarizeSimproShape(sanitizeSimproPayload(companies.body)),
    }),
  );
  if (companies.ok) fixturesSaved.push(saveFixture("companies-list", companies.body));

  const buildInfo = await simproGet(config, `/customers/?pageSize=1`, { maxRetries: 1 });
  probes.push(
    probeFromResult("company-scoped-ping", "/customers/?pageSize=1", buildInfo, {
      recordCount: extractSimproRecords(buildInfo.body).length,
      shape: summarizeSimproShape(sanitizeSimproPayload(buildInfo.body)),
    }),
  );

  // Sample jobs
  const jobsSample = await listSample(config, "jobs", 5);
  probes.push(
    probeFromResult("jobs-sample", jobsSample.path, jobsSample.result, {
      recordCount: jobsSample.records.length,
      shape: summarizeSimproShape(sanitizeSimproPayload(jobsSample.records[0] ?? {})),
    }),
  );
  summary.jobsSampled = jobsSample.records.length;
  if (jobsSample.result.ok) {
    fixturesSaved.push(saveFixture("jobs-sample", jobsSample.records));
  } else {
    errors.push(`Jobs sample failed HTTP ${jobsSample.result.status}`);
  }

  // Sample quotes
  const quotesSample = await listSample(config, "quotes", 5);
  probes.push(
    probeFromResult("quotes-sample", quotesSample.path, quotesSample.result, {
      recordCount: quotesSample.records.length,
      shape: summarizeSimproShape(sanitizeSimproPayload(quotesSample.records[0] ?? {})),
    }),
  );
  summary.quotesSampled = quotesSample.records.length;
  if (quotesSample.result.ok) {
    fixturesSaved.push(saveFixture("quotes-sample", quotesSample.records));
  } else {
    errors.push(`Quotes sample failed HTTP ${quotesSample.result.status}`);
  }

  async function deepen(entity: "jobs" | "quotes", sample: UnknownRecord[]) {
    const id = simproRecordId(sample[0]);
    if (!id) {
      errors.push(`No ${entity} id available for full discovery`);
      return;
    }
    if (entity === "jobs") summary.fullJobId = id;
    else summary.fullQuoteId = id;

    const full = await fetchFullRecord(config, entity, id);
    probes.push(
      probeFromResult(`${entity}-full`, `/${entity}/${id}/?display=all`, full, {
        recordId: id,
        shape: summarizeSimproShape(sanitizeSimproPayload(full.body)),
      }),
    );
    if (full.ok) fixturesSaved.push(saveFixture(`${entity}-full-${id}`, full.body));
    else errors.push(`Full ${entity} ${id} failed HTTP ${full.status}`);

    const sections = await fetchSections(config, entity, id);
    probes.push(
      probeFromResult(`${entity}-sections`, `/${entity}/${id}/sections/`, sections.result, {
        recordId: id,
        recordCount: sections.records.length,
        shape: summarizeSimproShape(sanitizeSimproPayload(sections.records[0] ?? {})),
      }),
    );
    if (sections.result.ok) fixturesSaved.push(saveFixture(`${entity}-sections-${id}`, sections.records));
    if (entity === "jobs") summary.jobSections = sections.records.length;
    else summary.quoteSections = sections.records.length;

    let costCentreTotal = 0;
    const itemCollections = new Set<string>();
    for (const section of sections.records.slice(0, 3)) {
      const sectionId = simproRecordId(section);
      if (!sectionId) continue;
      const centres = await fetchCostCentres(config, entity, id, sectionId);
      costCentreTotal += centres.records.length;
      probes.push(
        probeFromResult(
          `${entity}-cost-centres-section-${sectionId}`,
          `/${entity}/${id}/sections/${sectionId}/costCenters/`,
          centres.result,
          {
            recordId: sectionId,
            recordCount: centres.records.length,
            shape: summarizeSimproShape(sanitizeSimproPayload(centres.records[0] ?? {})),
          },
        ),
      );
      if (centres.result.ok) {
        fixturesSaved.push(saveFixture(`${entity}-cost-centres-${id}-s${sectionId}`, centres.records));
      }

      for (const centre of centres.records.slice(0, 2)) {
        const ccId = simproRecordId(centre);
        if (!ccId) continue;
        const items = await probeItemCollections(config, entity, id, sectionId, ccId);
        for (const collection of items) {
          itemCollections.add(collection.name);
          fixturesSaved.push(
            saveFixture(`${entity}-items-${collection.name}-${id}-s${sectionId}-c${ccId}`, collection.body),
          );
          probes.push({
            label: `${entity}-items-${collection.name}`,
            path: collection.path,
            endpoint: `${config.baseUrl}/companies/${config.companyId}${collection.path}`,
            status: 200,
            ok: true,
            recordId: ccId,
            recordCount: collection.count,
          });
        }
      }
    }

    if (entity === "jobs") {
      summary.jobCostCentres = costCentreTotal;
      summary.jobItemCollections = [...itemCollections];
    } else {
      summary.quoteCostCentres = costCentreTotal;
      summary.quoteItemCollections = [...itemCollections];
    }

    const related = await probeRelated(config, entity, id);
    for (const item of related) {
      const relativePath = item.result.endpoint.includes(`/companies/${config.companyId}`)
        ? item.result.endpoint.split(`/companies/${config.companyId}`)[1] ?? item.label
        : item.label;
      probes.push(
        probeFromResult(item.label, relativePath, item.result, {
          recordId: id,
          recordCount: item.records.length,
          shape: summarizeSimproShape(sanitizeSimproPayload(item.result.body)),
        }),
      );
      if (item.result.ok) {
        fixturesSaved.push(saveFixture(`${item.label}-${id}`, item.result.body));
      }
    }
  }

  if (jobsSample.records.length) await deepen("jobs", jobsSample.records);
  if (quotesSample.records.length) await deepen("quotes", quotesSample.records);

  const finishedAt = new Date().toISOString();
  const result: SimproDiscoveryResult = {
    ok: errors.length === 0 && (summary.jobsSampled > 0 || summary.quotesSampled > 0),
    startedAt,
    finishedAt,
    companyId: config.companyId,
    baseUrlHost,
    probes: probes.map((probe) => ({
      ...probe,
      // Never echo full endpoints with tokens; endpoint already has no token.
      endpoint: probe.endpoint.replace(/([?&]access_token=)[^&]+/gi, "$1[REDACTED]"),
    })),
    fixturesSaved: fixturesSaved.map((path) => path.split(/[/\\]/).slice(-2).join("/")),
    summary,
    errors,
  };

  // Actor recorded only in store metadata via finished run
  void actor;
  discoveryStore.lastRun = result;
  writeServerStore("simpro-discovery-store", discoveryStore);
  saveFixture("discovery-summary", {
    ...result,
    probes: result.probes.map(({ shape: _shape, ...rest }) => rest),
  });

  return result;
}
