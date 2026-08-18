import type { HubRole } from "@/lib/access";

export type TrainerMaterialKind =
  | "guide"
  | "screenshot"
  | "video"
  | "faq"
  | "company_rule";

export type TrainerMaterial = {
  id: string;
  title: string;
  kind: TrainerMaterialKind;
  /** Approved source text Blake may quote or paraphrase. */
  content: string;
  /** Optional URL / path for screenshots or videos (approved assets only). */
  mediaUrl?: string;
  tags: string[];
  roles: HubRole[];
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TrainerCheckQuestion = {
  id: string;
  prompt: string;
  /** Expected gist — used for local/fallback understanding checks. */
  expectedPoints: string[];
  /** Hint Blake may give after a weak answer, still grounded in materials. */
  hintMaterialId?: string;
};

export type TrainerStepKind = "teach" | "check" | "demo" | "recap";

export type TrainerStep = {
  id: string;
  kind: TrainerStepKind;
  title: string;
  /** Script Blake speaks / shows for this step. */
  script: string;
  materialIds: string[];
  check?: TrainerCheckQuestion;
};

export type TrainerModule = {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  steps: TrainerStep[];
};

export type TrainerFlowStatus = "draft" | "published" | "archived";

export type TrainerFlow = {
  id: string;
  title: string;
  description: string;
  roles: HubRole[];
  status: TrainerFlowStatus;
  moduleIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TrainerSessionStatus =
  | "not_started"
  | "in_progress"
  | "paused"
  | "completed";

export type TrainerStepProgress = {
  stepId: string;
  completed: boolean;
  checkPassed?: boolean;
  attempts: number;
  lastAnswer?: string;
  completedAt?: string;
};

export type TrainerModuleProgress = {
  moduleId: string;
  status: TrainerSessionStatus;
  steps: TrainerStepProgress[];
  startedAt?: string;
  completedAt?: string;
};

export type TrainerProgress = {
  id: string;
  userId: string;
  userName: string;
  role: HubRole;
  flowId: string;
  status: TrainerSessionStatus;
  currentModuleId?: string;
  currentStepId?: string;
  modules: TrainerModuleProgress[];
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type TrainerStoreState = {
  materials: TrainerMaterial[];
  modules: TrainerModule[];
  flows: TrainerFlow[];
  progress: TrainerProgress[];
};

export type TrainerTurnMode = "continue" | "question" | "check_answer" | "start";

export type TrainerTurnRequest = {
  flowId: string;
  progressId?: string;
  userId?: string;
  userName?: string;
  role?: HubRole;
  mode: TrainerTurnMode;
  /** Free-form learner speech / text. */
  message?: string;
  /** Spoken conversation — keep answers short. */
  voice?: boolean;
};

export type TrainerCitation = {
  materialId: string;
  title: string;
  kind: TrainerMaterialKind;
};

export type TrainerTurnResponse = {
  reply: string;
  grounded: boolean;
  refused: boolean;
  citations: TrainerCitation[];
  progress: TrainerProgress;
  flow: TrainerFlow;
  module?: TrainerModule;
  step?: TrainerStep;
  phase: "intro" | "teach" | "check" | "answer" | "complete" | "refuse";
  checkResult?: {
    passed: boolean;
    feedback: string;
  };
  aiUsed: boolean;
};
