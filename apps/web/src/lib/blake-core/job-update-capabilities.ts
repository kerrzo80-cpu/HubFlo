import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import {
  addJobOfficeNote,
  createJobVariationDraft,
  getJobOfficeUpdates,
  jobNoteTypes,
  jobUpdatePriorities,
  resolveJobAttention,
} from "@/lib/job-office-updates";

import type { BlakeCapability } from "./types";

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 1 };
}

function objectInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Capability input must be an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function optionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function optionalNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[£,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new TypeError(`${label} must be zero or a positive number.`);
  return parsed;
}

function optionalBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export const listJobUpdatesCapability: BlakeCapability = {
  definition: definition({
    name: "list_job_updates",
    description: "Read the office notes and draft variations currently linked to a specific NeXa job. Use this for questions such as 'what notes are on that job?', 'what did I say about it?', or 'are there any variations on that job?'. The job may be supplied from recent conversation/tool context.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showJobs"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        job: { type: "string", description: "NeXa job id or J-reference already known from the conversation/search results." },
      },
      required: ["job"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { job: requiredString(raw.job, "Job") };
  },
  execute(input, context) {
    return getJobOfficeUpdates(context.actor.tenantId, input.job);
  },
};

export const addJobNoteCapability: BlakeCapability = {
  definition: definition({
    name: "add_job_note",
    description: "Add a durable note to a real NeXa job. This is the normal tool for spoken in-car/site notes such as 'add a note to that job...'. Unless the user explicitly says no follow-up is needed, create an Attention item so the office cannot forget the note. Use the job already established in conversation rather than asking for a reference again.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canEditJobs"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        job: { type: "string", description: "NeXa job id or J-reference from conversation context." },
        text: { type: "string" },
        noteType: { enum: jobNoteTypes },
        priority: { enum: jobUpdatePriorities },
        followUpRequired: { type: "boolean", description: "Default true. Set false only when the user clearly says it is informational/no action is required." },
      },
      required: ["job", "text"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      job: requiredString(raw.job, "Job"),
      text: requiredString(raw.text, "Note"),
      noteType: optionalString(raw.noteType),
      priority: optionalString(raw.priority),
      followUpRequired: optionalBoolean(raw.followUpRequired, true),
    };
  },
  execute(input, context) {
    const note = addJobOfficeNote({
      tenantId: context.actor.tenantId,
      jobIdentifier: input.job,
      text: input.text,
      noteType: input.noteType,
      priority: input.priority,
      followUpRequired: input.followUpRequired,
      createdBy: context.actor.name,
      source: "Blake",
    });
    return {
      ...note,
      ref: note.jobRef,
      attentionCreated: note.attentionStatus === "Open",
      updatesUrl: `/jobs/${encodeURIComponent(note.jobId)}/updates`,
    };
  },
};

export const createJobVariationCapability: BlakeCapability = {
  definition: definition({
    name: "create_job_variation",
    description: "Create a draft variation linked to an existing NeXa job from a natural spoken or typed instruction. Capture the user's short description and any known estimate, but do not invent scope, cost or sell price. The draft always raises a Variations Attention item for office review before commercial approval/sending.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canEditJobs"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        job: { type: "string", description: "NeXa job id or J-reference from conversation context." },
        description: { type: "string" },
        priority: { enum: jobUpdatePriorities },
        estimatedValue: { type: "number", minimum: 0, description: "Only include when the user supplied an amount or an authoritative NeXa figure is already known." },
        officeNote: { type: "string" },
      },
      required: ["job", "description"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      job: requiredString(raw.job, "Job"),
      description: requiredString(raw.description, "Variation description"),
      priority: optionalString(raw.priority),
      estimatedValue: optionalNumber(raw.estimatedValue, "Estimated variation value"),
      officeNote: optionalString(raw.officeNote),
    };
  },
  execute(input, context) {
    const variation = createJobVariationDraft({
      tenantId: context.actor.tenantId,
      jobIdentifier: input.job,
      description: input.description,
      priority: input.priority,
      estimatedValue: input.estimatedValue,
      officeNote: input.officeNote,
      createdBy: context.actor.name,
      source: "Blake",
    });
    return {
      ...variation,
      attentionCreated: true,
      updatesUrl: `/jobs/${encodeURIComponent(variation.jobId)}/updates`,
    };
  },
};

export const resolveJobAttentionCapability: BlakeCapability = {
  definition: definition({
    name: "resolve_job_attention",
    description: "Mark a specific job note follow-up or draft variation Attention item as dealt with after the user has reviewed it. Use list_job_updates first if the exact update id is not already known.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canEditJobs"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { enum: ["note", "variation"] },
        id: { type: "string" },
      },
      required: ["kind", "id"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const kind = requiredString(raw.kind, "Attention kind").toLowerCase();
    if (kind !== "note" && kind !== "variation") throw new TypeError("Attention kind must be note or variation.");
    return { kind, id: requiredString(raw.id, "Update id") } as { kind: "note" | "variation"; id: string };
  },
  execute(input, context) {
    return resolveJobAttention({
      tenantId: context.actor.tenantId,
      kind: input.kind,
      id: input.id,
      actor: context.actor.name,
    });
  },
};

export const jobUpdateCapabilities: BlakeCapability[] = [
  listJobUpdatesCapability,
  addJobNoteCapability,
  createJobVariationCapability,
  resolveJobAttentionCapability,
];
