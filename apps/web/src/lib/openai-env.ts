/**
 * Resolve OpenAI API key from the env names already used on Render and in docs.
 * Prefer OPENAI_API_KEY, then NEXA_OPENAI_API_KEY (nexa-live), then empty.
 */
export function resolveOpenAiApiKey() {
  return (
    process.env.OPENAI_API_KEY?.trim()
    || process.env.NEXA_OPENAI_API_KEY?.trim()
    || ""
  );
}

export function openAiApiKeyEnvName() {
  if (process.env.OPENAI_API_KEY?.trim()) return "OPENAI_API_KEY";
  if (process.env.NEXA_OPENAI_API_KEY?.trim()) return "NEXA_OPENAI_API_KEY";
  return "OPENAI_API_KEY or NEXA_OPENAI_API_KEY";
}
