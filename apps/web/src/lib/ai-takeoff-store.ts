import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { dedupeTakeoffLines } from "@/lib/ai-takeoff-calc";
import {
  DEFAULT_AI_TAKEOFF_PRICING_RULES,
  type AiTakeoffAssumption,
  type AiTakeoffLine,
  type AiTakeoffMessage,
  type AiTakeoffPricingRules,
  type AiTakeoffRevision,
  type AiTakeoffUploadedFile,
  type TenderAiTakeoffState,
} from "@/lib/ai-takeoff-assistant-types";

function storeName(tenderId: string) {
  return `nexa-tender-ai-takeoff-v1:${tenderId}`;
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function emptyTenderAiTakeoffState(tenderId: string): TenderAiTakeoffState {
  const revisionId = newId("rev");
  const now = new Date().toISOString();
  return {
    tenderId,
    activeRevisionId: revisionId,
    messages: [],
    files: [],
    lines: [],
    assumptions: [],
    pricingRules: { ...DEFAULT_AI_TAKEOFF_PRICING_RULES },
    revisions: [
      {
        id: revisionId,
        label: "Rev A",
        createdAt: now,
        summary: "Initial AI takeoff workspace",
      },
    ],
    houseTypes: [],
    plots: [],
    updatedAt: now,
  };
}

export function getTenderAiTakeoffState(tenderId: string): TenderAiTakeoffState {
  const clean = tenderId.trim();
  if (!clean) return emptyTenderAiTakeoffState("");
  const raw = loadServerStore<Partial<TenderAiTakeoffState>>(storeName(clean), emptyTenderAiTakeoffState(clean));
  const base = emptyTenderAiTakeoffState(clean);
  return {
    ...base,
    ...raw,
    tenderId: clean,
    pricingRules: { ...DEFAULT_AI_TAKEOFF_PRICING_RULES, ...(raw.pricingRules || {}) },
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    files: Array.isArray(raw.files) ? raw.files : [],
    lines: Array.isArray(raw.lines) ? raw.lines : [],
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions : [],
    revisions: Array.isArray(raw.revisions) && raw.revisions.length ? raw.revisions : base.revisions,
    houseTypes: Array.isArray(raw.houseTypes) ? raw.houseTypes : [],
    plots: Array.isArray(raw.plots) ? raw.plots : [],
    activeRevisionId: raw.activeRevisionId || base.activeRevisionId,
    updatedAt: raw.updatedAt || base.updatedAt,
  };
}

export function saveTenderAiTakeoffState(state: TenderAiTakeoffState): TenderAiTakeoffState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  if (next.lines.length > 2500) {
    next.lines = next.lines.slice(-2500);
  }
  if (next.assumptions.length > 120) {
    next.assumptions = next.assumptions.slice(-120);
  }
  writeServerStore(storeName(state.tenderId), next);
  return next;
}

export function appendAiTakeoffMessage(
  tenderId: string,
  message: Omit<AiTakeoffMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  const entry: AiTakeoffMessage = {
    id: message.id || newId("msg"),
    role: message.role,
    text: message.text,
    createdAt: message.createdAt || new Date().toISOString(),
    toolCalls: message.toolCalls,
    openaiResponseId: message.openaiResponseId,
  };
  state.messages = [...state.messages, entry].slice(-80);
  return saveTenderAiTakeoffState(state);
}

export function upsertAiTakeoffLines(tenderId: string, lines: AiTakeoffLine[]): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  const byId = new Map(state.lines.map((line) => [line.id, line]));
  for (const line of lines) byId.set(line.id, line);
  state.lines = Array.from(byId.values());
  return saveTenderAiTakeoffState(state);
}

export function clearAiTakeoffLines(
  tenderId: string,
  options?: { includeApplied?: boolean },
): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  const includeApplied = options?.includeApplied !== false;
  state.lines = includeApplied
    ? []
    : state.lines.filter((line) => line.status === "applied");
  return saveTenderAiTakeoffState(state);
}

/** Drop proposed/accepted lines from a source document before re-import (keeps applied). */
export function replaceAiTakeoffLinesFromSource(
  tenderId: string,
  sourceDocument: string,
  lines: AiTakeoffLine[],
): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  const source = sourceDocument.trim().toLowerCase();
  const kept = state.lines.filter((line) => {
    if (line.status === "applied") return true;
    const from = String(line.sourceDocument || "").trim().toLowerCase();
    return !source || from !== source;
  });
  const byId = new Map(kept.map((line) => [line.id, line]));
  for (const line of lines) byId.set(line.id, line);
  state.lines = Array.from(byId.values());
  return saveTenderAiTakeoffState(state);
}

export function addAiTakeoffAssumption(
  tenderId: string,
  assumption: Omit<AiTakeoffAssumption, "id" | "createdAt" | "revisionId"> & {
    id?: string;
    revisionId?: string;
  },
): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  state.assumptions.push({
    id: assumption.id || newId("asm"),
    revisionId: assumption.revisionId || state.activeRevisionId,
    kind: assumption.kind,
    text: assumption.text,
    status: assumption.status || "open",
    createdAt: new Date().toISOString(),
  });
  if (state.assumptions.length > 120) {
    state.assumptions = state.assumptions.slice(-120);
  }
  return saveTenderAiTakeoffState(state);
}

export function updateAiTakeoffPricingRules(
  tenderId: string,
  patch: Partial<AiTakeoffPricingRules>,
): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  state.pricingRules = { ...state.pricingRules, ...patch };
  return saveTenderAiTakeoffState(state);
}

export function setAiTakeoffHouseTypes(tenderId: string, houseTypes: string[]): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  state.houseTypes = Array.from(new Set(houseTypes.map((row) => row.trim()).filter(Boolean)));
  return saveTenderAiTakeoffState(state);
}

export function setAiTakeoffPlots(
  tenderId: string,
  plots: Array<{ plot: string; houseType: string }>,
): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  state.plots = plots
    .map((row) => ({ plot: String(row.plot || "").trim(), houseType: String(row.houseType || "").trim() }))
    .filter((row) => row.plot);
  return saveTenderAiTakeoffState(state);
}

export function attachAiTakeoffFile(
  tenderId: string,
  file: Omit<AiTakeoffUploadedFile, "id" | "uploadedAt"> & { id?: string },
): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  state.files = [
    ...state.files.filter((row) => row.tenderDocumentId !== file.tenderDocumentId || !file.tenderDocumentId),
    {
      id: file.id || newId("file"),
      tenderDocumentId: file.tenderDocumentId,
      name: file.name,
      kind: file.kind,
      mimeType: file.mimeType,
      url: file.url,
      notes: file.notes,
      uploadedAt: new Date().toISOString(),
    },
  ];
  return saveTenderAiTakeoffState(state);
}

export function createAiTakeoffRevision(
  tenderId: string,
  label: string,
  summary?: string,
  actor?: string,
): TenderAiTakeoffState {
  const state = getTenderAiTakeoffState(tenderId);
  const revision: AiTakeoffRevision = {
    id: newId("rev"),
    label,
    parentRevisionId: state.activeRevisionId,
    createdAt: new Date().toISOString(),
    createdBy: actor,
    summary,
  };
  state.revisions = [...state.revisions, revision];
  state.activeRevisionId = revision.id;
  return saveTenderAiTakeoffState(state);
}

export function makeAiTakeoffLineId() {
  return newId("line");
}

export function dedupeAiTakeoffLines(tenderId: string): { state: TenderAiTakeoffState; removed: number } {
  const state = getTenderAiTakeoffState(tenderId);
  const { lines, removed } = dedupeTakeoffLines(state.lines);
  if (!removed) return { state, removed: 0 };
  state.lines = lines;
  return { state: saveTenderAiTakeoffState(state), removed };
}
