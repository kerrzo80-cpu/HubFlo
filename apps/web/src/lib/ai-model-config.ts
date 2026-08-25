/**
 * Server-side AI model registry.
 * Workloads can use different models without hard-coding a single global choice.
 * Env vars override defaults; in-app stored model is a fallback for assistant/takeoff only.
 */

import { getStoredOpenAiConfig, DEFAULT_OPENAI_MODEL } from "@/lib/openai-key-store";

export type AiWorkload =
  | "assistant"
  | "survey"
  | "takeoff"
  | "field"
  | "vision"
  | "estimate"
  | "transcribe"
  | "tts"
  | "realtime";

const DEFAULTS: Record<AiWorkload, string> = {
  assistant: DEFAULT_OPENAI_MODEL,
  survey: DEFAULT_OPENAI_MODEL,
  takeoff: DEFAULT_OPENAI_MODEL,
  field: "gpt-4.1-mini",
  vision: "gpt-4.1-mini",
  estimate: DEFAULT_OPENAI_MODEL,
  transcribe: "gpt-4o-mini-transcribe",
  tts: "gpt-4o-mini-tts",
  realtime: "gpt-realtime",
};

function envFirst(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export function resolveAiModel(workload: AiWorkload): string {
  const stored = getStoredOpenAiConfig().model?.trim() || "";

  switch (workload) {
    case "assistant":
      return (
        envFirst("NEXA_ASSISTANT_OPENAI_MODEL", "OPENAI_MODEL")
        || stored
        || DEFAULTS.assistant
      );
    case "takeoff":
      return (
        envFirst("NEXA_TAKEOFF_OPENAI_MODEL", "OPENAI_MODEL")
        || stored
        || DEFAULTS.takeoff
      );
    case "survey":
      return (
        envFirst("NEXA_SURVEY_OPENAI_MODEL", "NEXA_ASSISTANT_OPENAI_MODEL", "OPENAI_MODEL")
        || stored
        || DEFAULTS.survey
      );
    case "field":
      return envFirst("NEXA_FIELD_OPENAI_MODEL", "OPENAI_MODEL") || DEFAULTS.field;
    case "vision":
      return (
        envFirst("NEXA_VISION_OPENAI_MODEL", "NEXA_FIELD_OPENAI_MODEL", "OPENAI_MODEL")
        || DEFAULTS.vision
      );
    case "estimate":
      return (
        envFirst("NEXA_ESTIMATE_OPENAI_MODEL", "NEXA_ASSISTANT_OPENAI_MODEL", "OPENAI_MODEL")
        || stored
        || DEFAULTS.estimate
      );
    case "transcribe":
      return envFirst("NEXA_TRANSCRIBE_OPENAI_MODEL") || DEFAULTS.transcribe;
    case "tts":
      return envFirst("NEXA_TTS_OPENAI_MODEL") || DEFAULTS.tts;
    case "realtime":
      return envFirst("NEXA_REALTIME_OPENAI_MODEL") || DEFAULTS.realtime;
    default:
      return DEFAULTS.assistant;
  }
}

export function listAiModelConfig() {
  return (Object.keys(DEFAULTS) as AiWorkload[]).map((workload) => ({
    workload,
    model: resolveAiModel(workload),
    defaultModel: DEFAULTS[workload],
  }));
}
