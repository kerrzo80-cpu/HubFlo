import { resolveOpenAiApiKey } from "@/lib/openai-env";
import {
  FAULT_MODULES,
  FAULT_PRIORITIES,
  FAULT_TYPES,
  guessModuleFromRoute,
  isFaultPriority,
  isFaultType,
  type FaultDevelopmentBrief,
  type FaultIssue,
  type FaultModule,
  type FaultPriority,
  type FaultType,
} from "@/lib/faults-types";

export type FaultAiClassifyResult = {
  title: string;
  module: FaultModule;
  type: FaultType;
  priority: FaultPriority;
  aiDescription: string;
  problem: string;
  currentBehaviour: string;
  requiredBehaviour: string;
  acceptanceCriteria: string[];
  aiUsed: boolean;
};

function heuristicClassify(input: {
  description: string;
  sourceRoute?: string;
  sourcePage?: string;
}): FaultAiClassifyResult {
  const text = input.description.trim();
  const lower = text.toLowerCase();
  const title =
    text
      .split(/[\n.!?]/)
      .map((part) => part.trim())
      .find(Boolean)
      ?.slice(0, 90) || "Issue report";
  let type: FaultType = "fault";
  if (/\b(improve|enhancement|better|should also|nice to)\b/i.test(lower)) type = "improvement";
  if (/\b(new feature|add support|can we add|wish)\b/i.test(lower)) type = "new_feature";
  if (/\b(ui|ux|layout|button|screen|looks|design)\b/i.test(lower)) type = "ui_ux";
  let priority: FaultPriority = "medium";
  if (/\b(urgent|critical|crash|can't work|cannot work|blocking|down)\b/i.test(lower)) priority = "urgent";
  else if (/\b(broken|not working|lost|resets|wrong|bug)\b/i.test(lower)) priority = "high";
  else if (/\b(minor|nit|cosmetic|later)\b/i.test(lower)) priority = "low";
  const module = guessModuleFromRoute(input.sourceRoute, input.sourcePage);
  return {
    title,
    module,
    type,
    priority,
    aiDescription: text,
    problem: title,
    currentBehaviour: text,
    requiredBehaviour: "NeXa should preserve the user’s expected behaviour without data loss or unexpected resets.",
    acceptanceCriteria: [
      "Reported behaviour is reproducible or clearly documented",
      "Required behaviour works on desktop",
      "Required behaviour works on mobile where relevant",
      "No regression to related flows",
    ],
    aiUsed: false,
  };
}

async function callStructuredJson(
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
  timeoutMs = 10_000,
) {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) return null;
  const model =
    process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim() ||
    process.env.NEXA_TAKEOFF_OPENAI_MODEL?.trim() ||
    "gpt-4.1-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: system }] },
          { role: "user", content: [{ type: "input_text", text: user }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
    });
    if (!response.ok) return null;
    const result = (await response.json()) as {
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text = result.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyFaultReport(input: {
  description: string;
  sourceRoute?: string;
  sourcePage?: string;
}): Promise<FaultAiClassifyResult> {
  const fallback = heuristicClassify(input);
  try {
    const parsed = await callStructuredJson(
      "You structure NeXa product fault/improvement reports. Keep important detail. Never invent evidence.",
      [
        `Source route: ${input.sourceRoute || "unknown"}`,
        `Source page: ${input.sourcePage || "unknown"}`,
        `Modules: ${FAULT_MODULES.join(", ")}`,
        "",
        "User report:",
        input.description,
      ].join("\n"),
      "nexa_fault_classify",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          module: { type: "string", enum: [...FAULT_MODULES] },
          type: { type: "string", enum: [...FAULT_TYPES] },
          priority: { type: "string", enum: [...FAULT_PRIORITIES] },
          aiDescription: { type: "string" },
          problem: { type: "string" },
          currentBehaviour: { type: "string" },
          requiredBehaviour: { type: "string" },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
        },
        required: [
          "title",
          "module",
          "type",
          "priority",
          "aiDescription",
          "problem",
          "currentBehaviour",
          "requiredBehaviour",
          "acceptanceCriteria",
        ],
      },
    );
    if (!parsed) return fallback;
    return {
      title: String(parsed.title || fallback.title).slice(0, 120),
      module: typeof parsed.module === "string" ? parsed.module : fallback.module,
      type: isFaultType(parsed.type) ? parsed.type : fallback.type,
      priority: isFaultPriority(parsed.priority) ? parsed.priority : fallback.priority,
      aiDescription: String(parsed.aiDescription || fallback.aiDescription),
      problem: String(parsed.problem || fallback.problem),
      currentBehaviour: String(parsed.currentBehaviour || fallback.currentBehaviour),
      requiredBehaviour: String(parsed.requiredBehaviour || fallback.requiredBehaviour),
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria)
        ? parsed.acceptanceCriteria.map(String).filter(Boolean).slice(0, 12)
        : fallback.acceptanceCriteria,
      aiUsed: true,
    };
  } catch {
    return fallback;
  }
}

export async function generateFaultDevelopmentBrief(
  issue: FaultIssue,
  actorName: string,
): Promise<FaultDevelopmentBrief> {
  const classified = await classifyFaultReport({
    description: [issue.title, issue.originalDescription, issue.aiDescription, issue.developmentNotes]
      .filter(Boolean)
      .join("\n\n"),
    sourceRoute: issue.sourceRoute,
    sourcePage: issue.sourcePage,
  });

  let technicalContext = `Module ${issue.module}. Source route ${issue.sourceRoute || "n/a"}.`;
  try {
    const parsed = await callStructuredJson(
      "You write development-ready briefs for the NeXa codebase (Next.js Core, Field, Survey, Takeoff, Heat Design).",
      [
        `Reference: ${issue.reference}`,
        `Module: ${issue.module}`,
        `Type: ${issue.type}`,
        `Original: ${issue.originalDescription}`,
        `Structured: ${issue.aiDescription || classified.aiDescription}`,
      ].join("\n"),
      "nexa_fault_brief",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          issueSummary: { type: "string" },
          currentBehaviour: { type: "string" },
          requiredBehaviour: { type: "string" },
          stepsToReproduce: { type: "string" },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
          technicalContext: { type: "string" },
        },
        required: [
          "issueSummary",
          "currentBehaviour",
          "requiredBehaviour",
          "stepsToReproduce",
          "acceptanceCriteria",
          "technicalContext",
        ],
      },
    );
    if (parsed) {
      technicalContext = String(parsed.technicalContext || technicalContext);
      const criteria = Array.isArray(parsed.acceptanceCriteria)
        ? parsed.acceptanceCriteria.map(String).filter(Boolean)
        : classified.acceptanceCriteria;
      const editableMarkdown = [
        `### Issue`,
        String(parsed.issueSummary || classified.problem),
        "",
        `### Current behaviour`,
        String(parsed.currentBehaviour || classified.currentBehaviour),
        "",
        `### Required behaviour`,
        String(parsed.requiredBehaviour || classified.requiredBehaviour),
        "",
        `### Steps to reproduce`,
        String(parsed.stepsToReproduce || issue.sourceRoute || "See original report"),
        "",
        `### Acceptance criteria`,
        ...criteria.map((item) => `- ${item}`),
        "",
        `### Technical context`,
        technicalContext,
      ].join("\n");
      return {
        generatedAt: new Date().toISOString(),
        generatedBy: actorName,
        issueSummary: String(parsed.issueSummary || classified.problem),
        currentBehaviour: String(parsed.currentBehaviour || classified.currentBehaviour),
        requiredBehaviour: String(parsed.requiredBehaviour || classified.requiredBehaviour),
        stepsToReproduce: String(parsed.stepsToReproduce || "See original report"),
        affectedModule: issue.module,
        acceptanceCriteria: criteria,
        attachmentsNote: `Attachments for ${issue.reference} via record-documents scope fault`,
        technicalContext,
        editableMarkdown,
      };
    }
  } catch {
    // fall through
  }

  const editableMarkdown = [
    `### Issue`,
    classified.problem,
    "",
    `### Current behaviour`,
    classified.currentBehaviour,
    "",
    `### Required behaviour`,
    classified.requiredBehaviour,
    "",
    `### Steps to reproduce`,
    issue.sourceRoute || "See original report",
    "",
    `### Acceptance criteria`,
    ...classified.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    `### Technical context`,
    technicalContext,
  ].join("\n");

  return {
    generatedAt: new Date().toISOString(),
    generatedBy: actorName,
    issueSummary: classified.problem,
    currentBehaviour: classified.currentBehaviour,
    requiredBehaviour: classified.requiredBehaviour,
    stepsToReproduce: issue.sourceRoute || "See original report",
    affectedModule: issue.module,
    acceptanceCriteria: classified.acceptanceCriteria,
    attachmentsNote: `Attachments for ${issue.reference} via record-documents scope fault`,
    technicalContext,
    editableMarkdown,
  };
}
