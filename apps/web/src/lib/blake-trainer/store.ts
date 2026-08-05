import { randomUUID } from "node:crypto";

import type { HubRole } from "@/lib/access";
import { createBlakeTrainerSeedState } from "@/lib/blake-trainer/seed";
import type {
  TrainerFlow,
  TrainerFlowStatus,
  TrainerMaterial,
  TrainerMaterialKind,
  TrainerModule,
  TrainerModuleProgress,
  TrainerProgress,
  TrainerSessionStatus,
  TrainerStep,
  TrainerStoreState,
} from "@/lib/blake-trainer/types";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

const STORE_NAME = "blake-trainer";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function readStore(): TrainerStoreState {
  return loadServerStore(STORE_NAME, createBlakeTrainerSeedState());
}

function saveStore(state: TrainerStoreState) {
  writeServerStore(STORE_NAME, state);
  return state;
}

export function getBlakeTrainerState(): TrainerStoreState {
  return clone(readStore());
}

export function listApprovedMaterials(role?: HubRole | null) {
  const materials = readStore().materials.filter((item) => item.approved);
  if (!role) return clone(materials);
  return clone(materials.filter((item) => item.roles.includes(role)));
}

export function listMaterials() {
  return clone(readStore().materials);
}

export function listModules() {
  return clone(readStore().modules);
}

export function listFlows(options?: { status?: TrainerFlowStatus; role?: HubRole | null }) {
  let flows = readStore().flows;
  if (options?.status) flows = flows.filter((flow) => flow.status === options.status);
  if (options?.role) flows = flows.filter((flow) => flow.roles.includes(options.role!));
  return clone(flows);
}

export function getFlow(flowId: string): TrainerFlow | null {
  const flow = readStore().flows.find((item) => item.id === flowId);
  return flow ? clone(flow) : null;
}

export function getModule(moduleId: string): TrainerModule | null {
  const mod = readStore().modules.find((item) => item.id === moduleId);
  return mod ? clone(mod) : null;
}

export function getMaterial(materialId: string): TrainerMaterial | null {
  const material = readStore().materials.find((item) => item.id === materialId);
  return material ? clone(material) : null;
}

export function getModulesForFlow(flow: TrainerFlow): TrainerModule[] {
  const byId = new Map(readStore().modules.map((mod) => [mod.id, mod]));
  return flow.moduleIds
    .map((id) => byId.get(id))
    .filter((mod): mod is TrainerModule => Boolean(mod))
    .map((mod) => clone(mod));
}

export function getApprovedMaterialsForStep(step: TrainerStep, role?: HubRole | null): TrainerMaterial[] {
  const byId = new Map(readStore().materials.map((item) => [item.id, item]));
  return step.materialIds
    .map((id) => byId.get(id))
    .filter((item): item is TrainerMaterial => Boolean(item) && Boolean(item?.approved))
    .filter((item) => !role || item.roles.includes(role))
    .map((item) => clone(item));
}

function emptyModuleProgress(moduleId: string, steps: TrainerStep[]): TrainerModuleProgress {
  return {
    moduleId,
    status: "not_started",
    steps: steps.map((step) => ({
      stepId: step.id,
      completed: false,
      attempts: 0,
    })),
  };
}

export function listProgress(options?: { userId?: string; flowId?: string }) {
  let rows = readStore().progress;
  if (options?.userId) rows = rows.filter((row) => row.userId === options.userId);
  if (options?.flowId) rows = rows.filter((row) => row.flowId === options.flowId);
  return clone(rows);
}

export function getProgress(progressId: string): TrainerProgress | null {
  const row = readStore().progress.find((item) => item.id === progressId);
  return row ? clone(row) : null;
}

export function startOrResumeProgress(input: {
  flowId: string;
  userId: string;
  userName: string;
  role: HubRole;
  progressId?: string;
}): TrainerProgress {
  const state = readStore();
  const flow = state.flows.find((item) => item.id === input.flowId);
  if (!flow) throw new Error("Training flow not found.");
  if (flow.status !== "published" && input.role !== "Owner/Admin" && input.role !== "Manager") {
    throw new Error("This training flow is not published.");
  }
  if (!flow.roles.includes(input.role) && input.role !== "Owner/Admin") {
    throw new Error("This training flow is not assigned to your role.");
  }

  if (input.progressId) {
    const existing = state.progress.find((item) => item.id === input.progressId);
    if (existing) return clone(existing);
  }

  const resume = state.progress.find(
    (item) =>
      item.userId === input.userId
      && item.flowId === input.flowId
      && item.status !== "completed",
  );
  if (resume) return clone(resume);

  const modules = getModulesForFlow(flow);
  const firstModule = modules[0];
  const firstStep = firstModule?.steps[0];
  const stamp = nowIso();
  const progress: TrainerProgress = {
    id: makeId("prog"),
    userId: input.userId,
    userName: input.userName,
    role: input.role,
    flowId: flow.id,
    status: "in_progress",
    currentModuleId: firstModule?.id,
    currentStepId: firstStep?.id,
    modules: modules.map((mod) => emptyModuleProgress(mod.id, mod.steps)),
    startedAt: stamp,
    updatedAt: stamp,
  };

  if (firstModule) {
    const modProg = progress.modules.find((item) => item.moduleId === firstModule.id);
    if (modProg) {
      modProg.status = "in_progress";
      modProg.startedAt = stamp;
    }
  }

  state.progress.push(progress);
  saveStore(state);
  return clone(progress);
}

export function saveProgress(progress: TrainerProgress): TrainerProgress {
  const state = readStore();
  const index = state.progress.findIndex((item) => item.id === progress.id);
  const next = { ...clone(progress), updatedAt: nowIso() };
  if (index >= 0) state.progress[index] = next;
  else state.progress.push(next);
  saveStore(state);
  return clone(next);
}

export function resolveCurrentStep(progress: TrainerProgress): {
  flow: TrainerFlow;
  module: TrainerModule | null;
  step: TrainerStep | null;
  moduleIndex: number;
  stepIndex: number;
} {
  const flow = getFlow(progress.flowId);
  if (!flow) throw new Error("Training flow not found.");
  const modules = getModulesForFlow(flow);
  const moduleIndex = Math.max(
    0,
    modules.findIndex((mod) => mod.id === progress.currentModuleId),
  );
  const module = modules[moduleIndex] ?? null;
  const stepIndex = module
    ? Math.max(0, module.steps.findIndex((step) => step.id === progress.currentStepId))
    : -1;
  const step = module && stepIndex >= 0 ? module.steps[stepIndex] ?? null : null;
  return { flow, module, step, moduleIndex, stepIndex };
}

export function markStepComplete(
  progress: TrainerProgress,
  stepId: string,
  options?: { checkPassed?: boolean; lastAnswer?: string },
): TrainerProgress {
  const next = clone(progress);
  const stamp = nowIso();
  let found = false;

  for (const mod of next.modules) {
    const step = mod.steps.find((item) => item.stepId === stepId);
    if (!step) continue;
    found = true;
    step.completed = true;
    step.completedAt = stamp;
    if (options?.checkPassed !== undefined) step.checkPassed = options.checkPassed;
    if (options?.lastAnswer !== undefined) step.lastAnswer = options.lastAnswer;
    if (mod.steps.every((item) => item.completed)) {
      mod.status = "completed";
      mod.completedAt = stamp;
    } else {
      mod.status = "in_progress";
      mod.startedAt ??= stamp;
    }
    break;
  }

  if (!found) return next;

  const { flow } = resolveCurrentStep(next);
  const modules = getModulesForFlow(flow);
  const flatSteps = modules.flatMap((mod) =>
    mod.steps.map((step) => ({ moduleId: mod.id, stepId: step.id })),
  );
  const currentIndex = flatSteps.findIndex((item) => item.stepId === stepId);
  const upcoming = flatSteps[currentIndex + 1];

  if (!upcoming) {
    next.status = "completed";
    next.completedAt = stamp;
    next.currentModuleId = modules[modules.length - 1]?.id;
    next.currentStepId = modules[modules.length - 1]?.steps.at(-1)?.id;
  } else {
    next.status = "in_progress";
    next.currentModuleId = upcoming.moduleId;
    next.currentStepId = upcoming.stepId;
    const nextMod = next.modules.find((item) => item.moduleId === upcoming.moduleId);
    if (nextMod && nextMod.status === "not_started") {
      nextMod.status = "in_progress";
      nextMod.startedAt = stamp;
    }
  }

  next.updatedAt = stamp;
  return saveProgress(next);
}

export function recordCheckAttempt(
  progress: TrainerProgress,
  stepId: string,
  answer: string,
): TrainerProgress {
  const next = clone(progress);
  for (const mod of next.modules) {
    const step = mod.steps.find((item) => item.stepId === stepId);
    if (!step) continue;
    step.attempts += 1;
    step.lastAnswer = answer;
    break;
  }
  next.updatedAt = nowIso();
  return saveProgress(next);
}

export function summariseCompletion(flowId?: string) {
  const state = readStore();
  const flows = flowId ? state.flows.filter((flow) => flow.id === flowId) : state.flows;
  return flows.map((flow) => {
    const rows = state.progress.filter((item) => item.flowId === flow.id);
    return {
      flowId: flow.id,
      title: flow.title,
      roles: flow.roles,
      status: flow.status,
      learners: rows.length,
      completed: rows.filter((item) => item.status === "completed").length,
      inProgress: rows.filter((item) => item.status === "in_progress" || item.status === "paused").length,
      notStarted: Math.max(0, rows.filter((item) => item.status === "not_started").length),
      rows: clone(rows),
    };
  });
}

/** Admin mutations */

export function upsertMaterial(input: Partial<TrainerMaterial> & { title: string; content: string; kind: TrainerMaterialKind }): TrainerMaterial {
  const state = readStore();
  const stamp = nowIso();
  const existingIndex = input.id ? state.materials.findIndex((item) => item.id === input.id) : -1;
  const base: TrainerMaterial =
    existingIndex >= 0
      ? state.materials[existingIndex]!
      : {
          id: makeId("mat"),
          title: input.title,
          kind: input.kind,
          content: input.content,
          tags: [],
          roles: ["Owner/Admin"],
          approved: false,
          createdAt: stamp,
          updatedAt: stamp,
        };

  const next: TrainerMaterial = {
    ...base,
    title: input.title.trim() || base.title,
    kind: input.kind || base.kind,
    content: input.content.trim() || base.content,
    mediaUrl: input.mediaUrl?.trim() || undefined,
    tags: input.tags ?? base.tags,
    roles: input.roles ?? base.roles,
    approved: input.approved ?? base.approved,
    approvedBy: input.approved ? input.approvedBy ?? base.approvedBy ?? "Brian Kerr" : undefined,
    approvedAt: input.approved ? input.approvedAt ?? stamp : undefined,
    updatedAt: stamp,
  };

  if (existingIndex >= 0) state.materials[existingIndex] = next;
  else state.materials.push(next);
  saveStore(state);
  return clone(next);
}

export function upsertFlow(input: Partial<TrainerFlow> & { title: string }): TrainerFlow {
  const state = readStore();
  const stamp = nowIso();
  const existingIndex = input.id ? state.flows.findIndex((item) => item.id === input.id) : -1;
  const base: TrainerFlow =
    existingIndex >= 0
      ? state.flows[existingIndex]!
      : {
          id: makeId("flow"),
          title: input.title,
          description: "",
          roles: ["Engineer"],
          status: "draft",
          moduleIds: [],
          createdBy: input.createdBy ?? "Brian Kerr",
          createdAt: stamp,
          updatedAt: stamp,
        };

  const next: TrainerFlow = {
    ...base,
    title: input.title.trim() || base.title,
    description: input.description?.trim() ?? base.description,
    roles: input.roles ?? base.roles,
    status: (input.status as TrainerFlowStatus) ?? base.status,
    moduleIds: input.moduleIds ?? base.moduleIds,
    updatedAt: stamp,
  };

  if (existingIndex >= 0) state.flows[existingIndex] = next;
  else state.flows.push(next);
  saveStore(state);
  return clone(next);
}

export function upsertModule(input: Partial<TrainerModule> & { title: string }): TrainerModule {
  const state = readStore();
  const stamp = nowIso();
  const existingIndex = input.id ? state.modules.findIndex((item) => item.id === input.id) : -1;
  const base: TrainerModule =
    existingIndex >= 0
      ? state.modules[existingIndex]!
      : {
          id: makeId("mod"),
          title: input.title,
          summary: "",
          estimatedMinutes: 10,
          steps: [],
        };

  const next: TrainerModule = {
    ...base,
    title: input.title.trim() || base.title,
    summary: input.summary?.trim() ?? base.summary,
    estimatedMinutes: input.estimatedMinutes ?? base.estimatedMinutes,
    steps: input.steps ?? base.steps,
  };

  // stamp unused but keeps parity with other upserts for future audit fields
  void stamp;

  if (existingIndex >= 0) state.modules[existingIndex] = next;
  else state.modules.push(next);
  saveStore(state);
  return clone(next);
}

export function setFlowStatus(flowId: string, status: TrainerFlowStatus): TrainerFlow {
  const flow = getFlow(flowId);
  if (!flow) throw new Error("Training flow not found.");
  if (status === "published") {
    const modules = getModulesForFlow(flow);
    if (!modules.length) throw new Error("Add at least one module before publishing.");
    for (const mod of modules) {
      for (const step of mod.steps) {
        const materials = getApprovedMaterialsForStep(step);
        if (!materials.length) {
          throw new Error(`Step "${step.title}" needs at least one approved material.`);
        }
      }
    }
  }
  return upsertFlow({ ...flow, status });
}

export function resetBlakeTrainerStoreForTests() {
  saveStore(createBlakeTrainerSeedState());
}

export type { TrainerSessionStatus };
