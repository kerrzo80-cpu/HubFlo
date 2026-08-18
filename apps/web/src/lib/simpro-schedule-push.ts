/**
 * NeXa → simPRO schedule write path for the managers diary.
 * Creates / updates / deletes job cost-centre schedules so Field My Day
 * and simPRO stay aligned without the legacy ewg-hub-scheduler diary.
 */

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { findSimproEntityLinkByNexa } from "@/lib/simpro-entity-links";
import {
  asRecord,
  extractSimproRecords,
  getSimproReadConfig,
  simproGet,
  simproRecordId,
  type UnknownRecord,
} from "@/lib/simpro-client";
import { getSimproDirectConfigStatus, type ResolvedSimproDirectConfig } from "@/lib/simpro-auth";
import { getJobs } from "@/lib/workflow-data";

export type SchedulePushAssignment = {
  id: string;
  jobId: string;
  costCentreId: string;
  costCentreName: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  plannedHours: number;
  notes: string;
  simproScheduleId?: string;
};

export type SchedulePushCostCentre = {
  id: string;
  name: string;
  simproSectionId?: string;
  simproCostCentreId?: string;
};

export type SchedulePushStatus = {
  configured: boolean;
  missing: string[];
  guidance: string;
  scheduleRateId?: number;
};

export type SchedulePushResultItem = {
  assignmentId: string;
  ok: boolean;
  action: "create" | "update" | "delete" | "skip";
  simproScheduleId?: string;
  summary: string;
  error?: string;
};

export type SchedulePushResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  simproJobId?: string;
  results: SchedulePushResultItem[];
  assignments: SchedulePushAssignment[];
};

type CostCentreSlot = {
  sectionId: number;
  costCenterId: number;
  name: string;
};

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function numericId(value?: string | number | null) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return undefined;
}

function normaliseName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function simproHttpErrorMessage(body: unknown, status: number, endpoint: string) {
  const record = asRecord(body) ?? {};
  const errors = record.errors;
  if (Array.isArray(errors) && errors.length) {
    const messages = errors
      .map((item) => asString(asRecord(item)?.message) || asString(item))
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  return (
    asString(record.error) ||
    asString(record.message) ||
    `Simpro returned HTTP ${status} from ${endpoint}`
  );
}

async function simproWrite(
  config: ResolvedSimproDirectConfig,
  path: string,
  init: RequestInit,
) {
  const endpoint = `${config.baseUrl}/companies/${config.companyId}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  return { endpoint, response, body };
}

/** Extract staff ID from NeXa employee ids like `simpro-staff-12` or plain numeric ids. */
export function parseSimproStaffId(employeeId: string): number | undefined {
  const trimmed = employeeId.trim();
  if (!trimmed) return undefined;
  const prefixed = trimmed.match(/^simpro-staff-(\d+)$/i);
  if (prefixed?.[1]) return Number(prefixed[1]);
  return numericId(trimmed);
}

/** Optional map: `nexaEmpId:12,otherId:34` or `Alex Plumber:12`. */
export function parseSimproStaffMap(raw = process.env.SIMPRO_STAFF_MAP || ""): Map<string, number> {
  const map = new Map<string, number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.lastIndexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const id = numericId(trimmed.slice(colon + 1));
    if (key && id) map.set(normaliseName(key), id);
  }
  return map;
}

export function resolveDefaultScheduleRateId(
  raw = process.env.SIMPRO_DEFAULT_SCHEDULE_RATE_ID || process.env.SIMPRO_SCHEDULE_RATE_ID || "",
): number | undefined {
  return numericId(raw);
}

export function getSimproSchedulePushStatus(): SchedulePushStatus {
  const direct = getSimproDirectConfigStatus();
  const scheduleRateId = resolveDefaultScheduleRateId();
  const missing = [
    ...(direct.configured ? [] : direct.missing),
    ...(scheduleRateId ? [] : ["SIMPRO_DEFAULT_SCHEDULE_RATE_ID"]),
  ];
  return {
    configured: missing.length === 0,
    missing,
    scheduleRateId,
    guidance: missing.length
      ? `Schedule push needs direct simPRO API access and a default rate. Missing: ${missing.join(", ")}. Set SIMPRO_DEFAULT_SCHEDULE_RATE_ID to a valid simPRO ScheduleRate ID, then schedule from NeXa Schedules.`
      : "Managers diary visits will write into simPRO schedules for linked jobs.",
  };
}

export function buildSimproScheduleBody(input: {
  staffId: number;
  date: string;
  startTime: string;
  endTime: string;
  scheduleRateId: number;
  notes?: string;
}) {
  return {
    Staff: input.staffId,
    Date: input.date.slice(0, 10),
    Notes: (input.notes || "").slice(0, 500),
    IsLocked: false,
    Blocks: [
      {
        StartTime: input.startTime.slice(0, 5),
        EndTime: input.endTime.slice(0, 5),
        ScheduleRate: input.scheduleRateId,
      },
    ],
  };
}

/** simPRO 422 often returns the existing schedule id in `errors[].value`. */
export function extractExistingScheduleId(body: unknown): number | undefined {
  const record = asRecord(body);
  if (!record) return undefined;
  const errors = record.errors;
  if (Array.isArray(errors)) {
    for (const item of errors) {
      const row = asRecord(item);
      const value = numericId(asString(row?.value)) || numericId(row?.value as number | undefined);
      if (value) return value;
      const message = asString(row?.message);
      const match = message.match(/refer to schedule\s+(\d+)/i);
      if (match?.[1]) return Number(match[1]);
    }
  }
  return numericId(asString(record.value)) || undefined;
}

function centresFromHub(jobId: string): SchedulePushCostCentre[] {
  const hub = getHubDetailState();
  const raw = hub.jobCostCentres?.[jobId];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => Boolean(item))
    .map((centre) => ({
      id: asString(centre.id),
      name: asString(centre.name, "Cost centre"),
      simproSectionId: asString(centre.simproSectionId) || undefined,
      simproCostCentreId: asString(centre.simproCostCentreId) || undefined,
    }))
    .filter((centre) => centre.id);
}

function assignmentsFromHub(jobId: string): SchedulePushAssignment[] {
  const hub = getHubDetailState();
  const raw = hub.jobSchedulePlans?.[jobId];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => Boolean(item))
    .map((row) => ({
      id: asString(row.id),
      jobId: asString(row.jobId, jobId),
      costCentreId: asString(row.costCentreId),
      costCentreName: asString(row.costCentreName, "Cost centre"),
      employeeId: asString(row.employeeId),
      employeeName: asString(row.employeeName, "Engineer"),
      startDate: asString(row.startDate).slice(0, 10),
      startTime: asString(row.startTime, "08:00").slice(0, 5),
      endDate: asString(row.endDate).slice(0, 10) || asString(row.startDate).slice(0, 10),
      endTime: asString(row.endTime, "16:00").slice(0, 5),
      plannedHours: typeof row.plannedHours === "number" ? row.plannedHours : Number(row.plannedHours) || 0,
      notes: asString(row.notes),
      simproScheduleId: asString(row.simproScheduleId) || undefined,
    }))
    .filter((row) => row.id);
}

function persistAssignments(jobId: string, assignments: SchedulePushAssignment[]) {
  const hub = getHubDetailState();
  saveHubDetailState({
    ...hub,
    jobSchedulePlans: {
      ...(hub.jobSchedulePlans || {}),
      [jobId]: assignments,
    },
  });
}

async function listJobCostCentreSlots(
  config: ResolvedSimproDirectConfig,
  simproJobId: string,
): Promise<CostCentreSlot[]> {
  const detailed = await simproGet(config, `/jobs/${simproJobId}/?display=all`);
  const slots: CostCentreSlot[] = [];
  const record = asRecord(detailed.body) ?? {};
  const sections = Array.isArray(record.Sections)
    ? record.Sections.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
    : [];

  for (const section of sections) {
    const sectionId = numericId(simproRecordId(section));
    if (!sectionId) continue;
    let costCenters = Array.isArray(section.CostCenters)
      ? section.CostCenters.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
      : [];
    if (!costCenters.length) {
      const listed = await simproGet(
        config,
        `/jobs/${simproJobId}/sections/${sectionId}/costCenters/?pageSize=50`,
      );
      if (listed.ok) costCenters = extractSimproRecords(listed.body);
    }
    for (const costCenter of costCenters) {
      const costCenterId = numericId(simproRecordId(costCenter));
      if (!costCenterId) continue;
      slots.push({
        sectionId,
        costCenterId,
        name:
          asString(costCenter.Name) ||
          asString(asRecord(costCenter.CostCenter)?.Name) ||
          `Cost centre ${costCenterId}`,
      });
    }
  }
  return slots;
}

function resolveCostCentreSlot(
  assignment: SchedulePushAssignment,
  centres: SchedulePushCostCentre[],
  slots: CostCentreSlot[],
  companyId: string,
): CostCentreSlot | null {
  const centre = centres.find((item) => item.id === assignment.costCentreId);
  const linked = findSimproEntityLinkByNexa({
    entityType: "costCentre",
    nexaId: assignment.costCentreId,
  });

  const sectionId =
    numericId(centre?.simproSectionId) ||
    numericId(findSimproEntityLinkByNexa({ entityType: "section", nexaId: centre?.id || "" })?.externalId);
  const costCenterId =
    numericId(centre?.simproCostCentreId) ||
    numericId(linked?.externalId);

  if (sectionId && costCenterId) {
    return {
      sectionId,
      costCenterId,
      name: centre?.name || assignment.costCentreName,
    };
  }

  if (costCenterId) {
    const byId = slots.find((slot) => slot.costCenterId === costCenterId);
    if (byId) return byId;
  }

  const targetName = normaliseName(centre?.name || assignment.costCentreName);
  if (targetName) {
    const byName = slots.find((slot) => normaliseName(slot.name) === targetName);
    if (byName) return byName;
  }

  void companyId;
  return slots[0] ?? null;
}

async function resolveStaffId(
  config: ResolvedSimproDirectConfig,
  assignment: SchedulePushAssignment,
  staffCache: { loaded: boolean; byName: Map<string, number> },
): Promise<number | undefined> {
  const fromId = parseSimproStaffId(assignment.employeeId);
  if (fromId) return fromId;

  const map = parseSimproStaffMap();
  const mapped =
    map.get(normaliseName(assignment.employeeId)) ||
    map.get(normaliseName(assignment.employeeName));
  if (mapped) return mapped;

  if (!staffCache.loaded) {
    const listed = await simproGet(config, "/staff/?pageSize=250");
    if (listed.ok) {
      for (const record of extractSimproRecords(listed.body)) {
        const id = numericId(simproRecordId(record));
        const name =
          asString(record.Name) ||
          asString(record.DisplayName) ||
          [asString(record.FirstName), asString(record.Surname || record.LastName)].filter(Boolean).join(" ");
        if (id && name) staffCache.byName.set(normaliseName(name), id);
      }
    }
    staffCache.loaded = true;
  }

  return staffCache.byName.get(normaliseName(assignment.employeeName));
}

async function createOrUpdateSchedule(input: {
  config: ResolvedSimproDirectConfig;
  simproJobId: string;
  slot: CostCentreSlot;
  assignment: SchedulePushAssignment;
  staffId: number;
  scheduleRateId: number;
}): Promise<{ simproScheduleId: string; action: "create" | "update" }> {
  const body = buildSimproScheduleBody({
    staffId: input.staffId,
    date: input.assignment.startDate,
    startTime: input.assignment.startTime,
    endTime: input.assignment.endTime,
    scheduleRateId: input.scheduleRateId,
    notes: input.assignment.notes,
  });
  const basePath = `/jobs/${input.simproJobId}/sections/${input.slot.sectionId}/costCenters/${input.slot.costCenterId}/schedules`;

  const existingId = numericId(input.assignment.simproScheduleId);
  if (existingId) {
    const patched = await simproWrite(input.config, `${basePath}/${existingId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!patched.response.ok) {
      throw new Error(simproHttpErrorMessage(patched.body, patched.response.status, patched.endpoint));
    }
    return { simproScheduleId: String(existingId), action: "update" };
  }

  const created = await simproWrite(input.config, `${basePath}/`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (created.response.ok) {
    const createdId =
      numericId(simproRecordId(asRecord(created.body))) ||
      numericId(asString(asRecord(created.body)?.ID));
    if (!createdId) {
      throw new Error("simPRO created the schedule but returned no ID.");
    }
    return { simproScheduleId: String(createdId), action: "create" };
  }

  const existing = extractExistingScheduleId(created.body);
  if (existing && (created.response.status === 422 || created.response.status === 409)) {
    const patched = await simproWrite(input.config, `${basePath}/${existing}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!patched.response.ok) {
      throw new Error(simproHttpErrorMessage(patched.body, patched.response.status, patched.endpoint));
    }
    return { simproScheduleId: String(existing), action: "update" };
  }

  throw new Error(simproHttpErrorMessage(created.body, created.response.status, created.endpoint));
}

async function deleteSchedule(input: {
  config: ResolvedSimproDirectConfig;
  simproJobId: string;
  slot: CostCentreSlot;
  simproScheduleId: string;
}) {
  const path = `/jobs/${input.simproJobId}/sections/${input.slot.sectionId}/costCenters/${input.slot.costCenterId}/schedules/${input.simproScheduleId}`;
  const deleted = await simproWrite(input.config, path, { method: "DELETE" });
  if (!deleted.response.ok && deleted.response.status !== 404) {
    throw new Error(simproHttpErrorMessage(deleted.body, deleted.response.status, deleted.endpoint));
  }
}

/**
 * Push one or more NeXa planner assignments into simPRO schedules for a linked job.
 * Also accepts delete of a previously pushed assignment (by id + simproScheduleId).
 */
export async function pushJobSchedulesToSimpro(input: {
  jobId: string;
  assignments?: SchedulePushAssignment[];
  /** When set, only these assignment ids are written (create/update). */
  upsertIds?: string[];
  /** Assignment ids to remove from simPRO (and optionally from returned plan). */
  deleteIds?: string[];
  persist?: boolean;
}): Promise<SchedulePushResult> {
  const job = getJobs().find((item) => item.id === input.jobId || item.ref === input.jobId);
  if (!job) {
    return {
      ok: false,
      skipped: true,
      reason: "Job not found",
      results: [],
      assignments: [],
    };
  }

  const simproJobId = String(job.simproJobId || "").trim();
  if (!simproJobId) {
    return {
      ok: true,
      skipped: true,
      reason: "Job is not linked to simPRO yet. Push the job first, then schedule visits.",
      results: [],
      assignments: input.assignments ?? assignmentsFromHub(job.id),
    };
  }

  const status = getSimproSchedulePushStatus();
  if (!status.configured || !status.scheduleRateId) {
    return {
      ok: false,
      skipped: true,
      reason: status.guidance,
      simproJobId,
      results: [],
      assignments: input.assignments ?? assignmentsFromHub(job.id),
    };
  }

  const config = await getSimproReadConfig();
  const hubsCentres = centresFromHub(job.id);
  const provided = input.assignments ?? assignmentsFromHub(job.id);
  let nextAssignments = [...provided];
  const slots = await listJobCostCentreSlots(config, simproJobId);
  const staffCache = { loaded: false, byName: new Map<string, number>() };
  const results: SchedulePushResultItem[] = [];

  const deleteIds = new Set((input.deleteIds ?? []).filter(Boolean));
  for (const deleteId of deleteIds) {
    const existing = nextAssignments.find((item) => item.id === deleteId);
    if (!existing?.simproScheduleId) {
      results.push({
        assignmentId: deleteId,
        ok: true,
        action: "skip",
        summary: "No simPRO schedule id to delete.",
      });
      nextAssignments = nextAssignments.filter((item) => item.id !== deleteId);
      continue;
    }
    try {
      const slot = resolveCostCentreSlot(existing, hubsCentres, slots, config.companyId);
      if (!slot) {
        throw new Error(`No simPRO cost centre found for "${existing.costCentreName}". Import the job cost centres first.`);
      }
      await deleteSchedule({
        config,
        simproJobId,
        slot,
        simproScheduleId: existing.simproScheduleId,
      });
      nextAssignments = nextAssignments.filter((item) => item.id !== deleteId);
      results.push({
        assignmentId: deleteId,
        ok: true,
        action: "delete",
        simproScheduleId: existing.simproScheduleId,
        summary: `Removed schedule ${existing.simproScheduleId} from simPRO.`,
      });
    } catch (error) {
      results.push({
        assignmentId: deleteId,
        ok: false,
        action: "delete",
        simproScheduleId: existing.simproScheduleId,
        summary: "Could not delete simPRO schedule.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const upsertFilter = input.upsertIds?.length
    ? new Set(input.upsertIds)
    : input.deleteIds?.length
      ? new Set<string>() // delete-only calls must not rewrite every remaining visit
      : null;
  for (const assignment of nextAssignments) {
    if (upsertFilter && !upsertFilter.has(assignment.id)) continue;
    try {
      const staffId = await resolveStaffId(config, assignment, staffCache);
      if (!staffId) {
        throw new Error(
          `Could not map "${assignment.employeeName}" to a simPRO staff ID. Use an imported engineer (simpro-staff-…) or set SIMPRO_STAFF_MAP.`,
        );
      }
      const slot = resolveCostCentreSlot(assignment, hubsCentres, slots, config.companyId);
      if (!slot) {
        throw new Error(
          `No simPRO cost centre found for "${assignment.costCentreName}". Pull the job from simPRO (or push the job) so cost centres are linked.`,
        );
      }
      const written = await createOrUpdateSchedule({
        config,
        simproJobId,
        slot,
        assignment,
        staffId,
        scheduleRateId: status.scheduleRateId,
      });
      nextAssignments = nextAssignments.map((item) =>
        item.id === assignment.id
          ? { ...item, simproScheduleId: written.simproScheduleId }
          : item,
      );
      results.push({
        assignmentId: assignment.id,
        ok: true,
        action: written.action,
        simproScheduleId: written.simproScheduleId,
        summary:
          written.action === "create"
            ? `Created simPRO schedule ${written.simproScheduleId}.`
            : `Updated simPRO schedule ${written.simproScheduleId}.`,
      });
    } catch (error) {
      results.push({
        assignmentId: assignment.id,
        ok: false,
        action: assignment.simproScheduleId ? "update" : "create",
        simproScheduleId: assignment.simproScheduleId,
        summary: "Could not push schedule to simPRO.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (input.persist !== false) {
    persistAssignments(job.id, nextAssignments);
  }

  const failed = results.filter((item) => !item.ok);
  return {
    ok: failed.length === 0,
    skipped: false,
    simproJobId,
    results,
    assignments: nextAssignments,
    reason: failed.length
      ? failed.map((item) => item.error || item.summary).join(" · ")
      : undefined,
  };
}
