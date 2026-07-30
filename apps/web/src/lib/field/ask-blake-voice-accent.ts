/** Blake spoken accent options for Talk / TTS. */

export const BLAKE_VOICE_ACCENTS = ["scottish", "english", "american"] as const;

export type BlakeVoiceAccent = (typeof BLAKE_VOICE_ACCENTS)[number];

export const BLAKE_VOICE_ACCENT_LABELS: Record<BlakeVoiceAccent, string> = {
  scottish: "Scottish",
  english: "English",
  american: "American",
};

const STORAGE_KEY = "nexa-field:blake-voice-accent:v1";

export function isBlakeVoiceAccent(value: unknown): value is BlakeVoiceAccent {
  return value === "scottish" || value === "english" || value === "american";
}

export function normaliseBlakeVoiceAccent(value: unknown): BlakeVoiceAccent {
  return isBlakeVoiceAccent(value) ? value : "scottish";
}

export function readStoredBlakeVoiceAccent(): BlakeVoiceAccent {
  if (typeof window === "undefined") return "scottish";
  try {
    return normaliseBlakeVoiceAccent(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "scottish";
  }
}

export function storeBlakeVoiceAccent(accent: BlakeVoiceAccent) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, accent);
  } catch {
    // ignore quota / private mode
  }
}

/** OpenAI Realtime / TTS voice id per accent. */
export function openaiVoiceForAccent(accent: BlakeVoiceAccent): string {
  if (accent === "american") return "ash";
  if (accent === "english") return "verse";
  return "cedar";
}

export function accentPromptBlock(accent: BlakeVoiceAccent): string {
  if (accent === "american") {
    return [
      "VOICE (non-negotiable): Speak every word in a clear General American accent.",
      "Do NOT use a Scottish or British accent.",
      "Sound like a practical US tradesman on site: warm, male, plain English.",
      "Normal American English vocabulary and pronunciation. No forced slang.",
    ].join("\n");
  }
  if (accent === "english") {
    return [
      "VOICE (non-negotiable): Speak every word in a clear English (England) accent — natural Southern English / standard British.",
      "Do NOT use an American accent. Do NOT use a strong Scottish accent.",
      "Sound like a UK plumber on site: warm, male, plain English — not posh BBC caricature.",
      "British English vocabulary and pronunciation. No forced slang.",
    ].join("\n");
  }
  return [
    "VOICE (non-negotiable): Speak every word in a clear Scottish accent — north-east Scotland / Aberdeenshire.",
    "Do NOT use an American accent. Do NOT use General American vowels or US intonation.",
    "Sound like a Scottish plumber talking on site: warm, male, plain English — not comedy, not slang stuffing.",
    "Say normal UK English words with Scottish pronunciation. Avoid forcing ‘aye/wee’ into every sentence.",
  ].join("\n");
}

export function accentLockLine(accent: BlakeVoiceAccent): string {
  if (accent === "american") {
    return "VOICE: Clear General American accent on every word. Never Scottish or British. Brief trade answers only. You are Ask Blake for plumbers on site.";
  }
  if (accent === "english") {
    return "VOICE: Clear English (England) accent on every word. Never American. Never strong Scots. Brief trade answers only. You are Ask Blake for UK plumbers on site.";
  }
  return "VOICE: Clear Scottish accent (Aberdeen / north-east Scotland) on every word. Never American. Never slang stuffing. Brief trade answers only. You are Ask Blake for UK plumbers on site.";
}

export function accentGreetingLine(accent: BlakeVoiceAccent): string {
  if (accent === "american") {
    return "In a clear American accent, say a short hello as Blake and ask what’s up on site. One sentence.";
  }
  if (accent === "english") {
    return "In a clear English accent, say a short hello as Blake and ask what’s up on site. One sentence.";
  }
  return "In a clear Scottish accent, say a short hello as Blake and ask what’s up on site. One sentence.";
}

export function accentTtsInstructions(accent: BlakeVoiceAccent): string {
  if (accent === "american") {
    return "Speak with a consistent General American accent. Male tradesman. Clear on a noisy site. Never British or Scottish.";
  }
  if (accent === "english") {
    return "Speak with a consistent English (England) accent. Male tradesman. Clear on a noisy site. Never American. Never strong Scottish.";
  }
  return [
    "Speak with a consistent Scottish accent from Aberdeen / north-east Scotland.",
    "Male tradesman. Clear on a noisy site. Never American. Never RP ‘BBC’ English.",
    "Normal UK English vocabulary — Scottish pronunciation, not slang performance.",
  ].join(" ");
}

export function buildRealtimeInstructions(accent: BlakeVoiceAccent): string {
  return [
    accentPromptBlock(accent),
    "",
    "Role: Ask Blake — on-site co-pilot for plumbers / heating engineers / joiners.",
    "Peer-to-peer. Brief answers (about 20–60 spoken words). One follow-up question max.",
    "No DIY lectures, no tool shopping lists, no ‘call a professional’ padding.",
    "If live camera frames arrive, use what you can see with what they’re saying.",
  ].join("\n");
}
