import { createHash, randomUUID } from "node:crypto";

import {
  calculateRoomHeatLoss,
  makeBlankProject,
  normaliseProject,
  type HeatDesignProject,
  type HeatDesignRevision,
} from "@/lib/heat-design";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

export const heatDesignStoreName = "heat-design-v1";
const schemaVersion = 1;
const maxRevisionCount = 50;

export type HeatDesignStore = {
  schemaVersion: number;
  projects: HeatDesignProject[];
};

const emptyStore: HeatDesignStore = {
  schemaVersion,
  projects: [],
};

let store = normaliseStore(loadServerStore<HeatDesignStore>(heatDesignStoreName, emptyStore));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `hd-project-${randomUUID()}`;
}

function makeRevisionId() {
  return `hd-revision-${randomUUID()}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function projectSnapshotHash(project: HeatDesignProject) {
  const { revisions: _revisions, ...snapshot } = project;
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 12);
}

function revisionSummary(project: HeatDesignProject) {
  try {
    const heatLossWatts = project.rooms.reduce((total, room) => {
      return (
        total +
        calculateRoomHeatLoss(
          { ...room, meanWaterTemperature: String(project.flowTemperature) },
          project.designExternalTemp,
        ).watts
      );
    }, 0);
    const roomLabel = `${project.rooms.length} room${project.rooms.length === 1 ? "" : "s"}`;
    return `Saved ${roomLabel} · ${Math.round(heatLossWatts).toLocaleString("en-GB")} W heat loss`;
  } catch {
    return "Project saved";
  }
}

function appendRevision(project: HeatDesignProject, priorRevisions: HeatDesignRevision[] = []) {
  const revision: HeatDesignRevision = {
    id: makeRevisionId(),
    at: nowIso(),
    summary: revisionSummary(project),
    snapshotHash: projectSnapshotHash(project),
  };
  return [revision, ...priorRevisions].slice(0, maxRevisionCount);
}

function withProjectDefaults(project: Partial<HeatDesignProject> = {}): HeatDesignProject {
  const now = nowIso();
  const blank = makeBlankProject();
  return normaliseProject({
    ...blank,
    ...project,
    id: stringValue(project.id) || makeId(),
    name: stringValue(project.name) || blank.name,
    updatedAt: stringValue(project.updatedAt) || now,
  } as HeatDesignProject);
}

function normaliseStore(value: HeatDesignStore): HeatDesignStore {
  return {
    schemaVersion,
    projects: Array.isArray(value.projects) ? value.projects.map((project) => withProjectDefaults(project)) : [],
  };
}

function persist() {
  writeServerStore(heatDesignStoreName, store);
}

export function listHeatDesignProjects() {
  return clone([...store.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export function getHeatDesignProject(id: string) {
  const project = store.projects.find((item) => item.id === id);
  return project ? clone(project) : undefined;
}

export function saveHeatDesignProject(project: Partial<HeatDesignProject>) {
  const saved = withProjectDefaults(project);
  const index = store.projects.findIndex((item) => item.id === saved.id);
  const existing = index >= 0 ? store.projects[index] : undefined;
  const priorRevisions = existing?.revisions ?? saved.revisions ?? [];
  saved.revisions = appendRevision(saved, priorRevisions);
  if (index >= 0) {
    store.projects[index] = saved;
  } else {
    store.projects.unshift(saved);
  }
  persist();
  return clone(saved);
}

export function listHeatDesignRevisions(projectId: string) {
  const project = store.projects.find((item) => item.id === projectId);
  return clone(project?.revisions ?? []);
}

export function deleteHeatDesignProject(id: string) {
  const index = store.projects.findIndex((item) => item.id === id);
  if (index < 0) return false;
  store.projects.splice(index, 1);
  persist();
  return true;
}

export function createHeatDesignProject(partial: Partial<HeatDesignProject> = {}) {
  const project = withProjectDefaults({
    ...partial,
    id: stringValue(partial.id) || makeId(),
    updatedAt: stringValue(partial.updatedAt) || nowIso(),
  });
  store.projects.unshift(project);
  persist();
  return clone(project);
}

export function resetHeatDesignStoreForTests(nextStore: Partial<HeatDesignStore> = {}) {
  store = normaliseStore({ ...emptyStore, ...nextStore });
  persist();
}
