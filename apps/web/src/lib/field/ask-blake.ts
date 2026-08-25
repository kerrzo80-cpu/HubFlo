import { accentTtsInstructions } from "@/lib/field/ask-blake-voice-accent";

export type AskBlakeMessage = {
  role: "user" | "assistant";
  text: string;
  hasImage?: boolean;
  imageCount?: number;
};

export type AskBlakeJobContext = {
  scheduleId?: string;
  jobRef?: string;
  customer?: string;
  costCentre?: string;
  trade?: string;
  address?: string;
  description?: string;
  accessNotes?: string;
  officeNotes?: string[];
  status?: string;
};

export type AskBlakeRequest = {
  message: string;
  /** @deprecated Prefer imageDataUrls — kept for older clients. */
  imageDataUrl?: string;
  imageDataUrls?: string[];
  history?: AskBlakeMessage[];
  job?: AskBlakeJobContext | null;
  /** Spoken conversation — keep answers short enough to say aloud. */
  mode?: "text" | "voice";
};

export const ASK_BLAKE_MAX_PHOTOS = 6;

export function normaliseAskBlakeImages(input: Pick<AskBlakeRequest, "imageDataUrl" | "imageDataUrls">) {
  const fromList = Array.isArray(input.imageDataUrls) ? input.imageDataUrls : [];
  const legacy = input.imageDataUrl ? [input.imageDataUrl] : [];
  const merged = [...fromList, ...legacy]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.startsWith("data:image/"));
  return [...new Set(merged)].slice(0, ASK_BLAKE_MAX_PHOTOS);
}

export const ASK_BLAKE_SYSTEM_PROMPT = [
  "You are Ask Ayla — EWG Field’s on-site co-pilot for qualified UK plumbers, heating engineers and joiners.",
  "CRITICAL: The person talking to you IS the engineer on site — usually Gas Safe / heating / plumbing trade. They are not a homeowner and not DIY.",
  "Talk peer-to-peer like a mate on the tools. Never patronising.",
  "Help diagnose faults from a short description and/or site photos, then give sharp checks and next steps.",
  "",
  "Never tell them to:",
  "- “get a gas engineer”, “call a gas engineer”, “hire a Gas Safe engineer”, or “get a professional in”",
  "- “call a plumber / heating engineer / qualified person” — they already are that person",
  "- DIY “when to call for help / call a professional” sections",
  "If competence or certification genuinely matters (e.g. work outside their ticket), say so plainly as a trade note — do not redirect them as if they were the customer.",
  "",
  "Do NOT include:",
  "- Tool lists or “what you’ll need” sections (they already know their kit)",
  "- Homeowner-style safety lectures, unless there is an immediate life-safety risk (gas escape, CO, live electrics)",
  "",
  "For gas / CO emergencies only: isolate / ventilate per good practice, National Gas Emergency 0800 111 999 if needed, and notify the office — still speak to them as the engineer doing it.",
  "",
  "Response style:",
  "- Answer the engineer’s actual question first.",
  "- Keep it concise for someone standing on site. Plain text and short dash bullets only.",
  "- Prefer UK trade practice and language (British English spelling).",
  "- Do not force Scottish slang (aye/wee) into typed answers — keep them clear and direct.",
  "- Never invent meter readings, gas pressures, part numbers you cannot see, or prices.",
  "- If photos are attached, say only what you can actually see across them, then likely causes and checks.",
  "- Mention parts only if a specific part is the likely fix — not a shopping list of tools.",
  "",
  "Prefer this shape when diagnosing:",
  "1) Likely issue",
  "2) Quick checks (readings / tests they can do now)",
  "3) Next steps on site",
].join("\n");

export const ASK_BLAKE_VOICE_PROMPT_EXTRA = [
  "This turn is a spoken conversation on site with the engineer — not a customer.",
  "Never say get/call a gas engineer or hire a professional. Give peer checks and next steps.",
  "Reply like you’re talking next to them — short sentences, no long lists.",
  "Aim for about 20–60 spoken words unless a safety point needs more.",
  "Ask at most one follow-up question at the end if you need a clearer symptom.",
].join("\n");

/** @deprecated Prefer accentTtsInstructions("scottish") from ask-blake-voice-accent. */
export const ASK_BLAKE_SCOTTISH_VOICE_INSTRUCTIONS = accentTtsInstructions("scottish");

export function askBlakeDeveloperPrompt(mode: AskBlakeRequest["mode"] = "text") {
  if (mode === "voice") return `${ASK_BLAKE_SYSTEM_PROMPT}\n\n${ASK_BLAKE_VOICE_PROMPT_EXTRA}`;
  return ASK_BLAKE_SYSTEM_PROMPT;
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

export function buildAskBlakeFallback(input: AskBlakeRequest) {
  const text = input.message.toLowerCase();
  const photos = normaliseAskBlakeImages(input);
  const jobBit = input.job?.jobRef
    ? `On ${input.job.jobRef}${input.job.costCentre ? ` (${input.job.costCentre})` : ""}: `
    : "";

  if (includesAny(text, ["gas smell", "smell of gas", "co alarm", "carbon monoxide"])) {
    return [
      `${jobBit}Treat as emergency until proven otherwise.`,
      "- No sparks / switches if you can smell gas.",
      "- Ventilate if safe; isolate at meter if you’re competent to do so.",
      "- National Gas Emergency Service: 0800 111 999. Notify the office.",
    ].join("\n");
  }

  if (includesAny(text, ["leak", "dripping", "burst", "flood"])) {
    return [
      `${jobBit}Likely water leak — isolate first.`,
      "Quick checks:",
      "- Nearest service valve / stopcock.",
      "- Mains cold, hot, heating, or waste?",
      "- Joints, valves, appliance connections, any recent work.",
      "Next: pin the source, then repair or cap off.",
      photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} received — OpenAI is offline, so this is a general field fallback.` : "",
    ].filter(Boolean).join("\n");
  }

  if (includesAny(text, ["no hot water", "hot water", "boiler", "heating", "radiator", "cylinder"])) {
    return [
      `${jobBit}Likely heating / hot-water fault.`,
      "Quick checks:",
      "- Power, programmer, room stat, boiler fault code / lockout.",
      "- Sealed system pressure (~1.0–1.5 bar cold).",
      "- Condensate, gas supply, recent RCD / fuse trip.",
      "- One cold rad: bleed, lockshield, pump / zone valve.",
      "Next: work from the fault code / symptom — don’t reset repeatedly without finding the cause.",
    ].join("\n");
  }

  if (includesAny(text, ["toilet", "cistern", "blocked", "blockage", "drain", "waste"])) {
    return [
      `${jobBit}Likely sanitary / waste issue.`,
      "Quick checks:",
      "- One fitting or several? Local vs stack / drain.",
      "- Toilet: fill, siphon / flapper, outlet restriction.",
      "- Rod / auger from nearest access — don’t force chemicals into unknown pipework.",
      "Next: clear the restriction, then confirm free flow on flush.",
    ].join("\n");
  }

  if (includesAny(text, ["tap", "mixer", "shower", "pressure", "no water"])) {
    return [
      `${jobBit}Likely supply / outlet issue.`,
      "Quick checks:",
      "- Isolation valves open; filters / aerators clear.",
      "- Hot vs cold and other outlets — isolate the fault.",
      "- Shower: pump (if fitted), cartridge, scaled head.",
      "Next: fix the restricted outlet or upstream supply fault.",
    ].join("\n");
  }

  return [
    `${jobBit}Ask Ayla is ready — OpenAI is not connected on this pilot, so here’s a starter.`,
    "Tell me what you can see / hear (or attach photos), the system type, and what you’ve already tried.",
    "I’ll come back with likely issue, quick checks and next steps — no tool lists.",
  ].join("\n");
}

export function buildAskBlakeUserPayload(input: AskBlakeRequest) {
  const history = (input.history ?? [])
    .slice(-10)
    .map((item) => `${item.role === "assistant" ? "Ayla" : "Engineer"}: ${item.text}`)
    .join("\n");

  const job = input.job;
  const jobLines = job
    ? [
        "Current job pack context:",
        `Job: ${job.jobRef ?? "unknown"} · ${job.customer ?? ""}`,
        `Cost centre / trade: ${job.costCentre ?? ""} / ${job.trade ?? ""}`,
        `Address: ${job.address ?? ""}`,
        `Status: ${job.status ?? ""}`,
        `Description: ${job.description ?? ""}`,
        `Access: ${job.accessNotes ?? ""}`,
        `Office notes: ${(job.officeNotes ?? []).join(" | ") || "none"}`,
      ].join("\n")
    : "No specific job selected — general field question.";

  const photoCount = normaliseAskBlakeImages(input).length;

  return [
    "Audience: the qualified engineer on site (Gas Safe / plumbing / heating / joinery). Do not tell them to get a gas engineer or hire a professional.",
    "",
    jobLines,
    "",
    history ? `Recent Ask Ayla chat:\n${history}` : "No prior chat turns.",
    "",
    `Engineer message: ${input.message}`,
    photoCount
      ? `${photoCount} site photo${photoCount === 1 ? "" : "s"} attached — review all of them.`
      : "No photo attached.",
  ].join("\n");
}

export function getOutputText(response: unknown) {
  if (response && typeof response === "object" && "output_text" in response && typeof response.output_text === "string") {
    return response.output_text.trim();
  }
  const output = response && typeof response === "object" && "output" in response ? response.output : null;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return [];
    return item.content.map((content: unknown) => (
      content && typeof content === "object" && "text" in content && typeof content.text === "string"
        ? content.text
        : ""
    ));
  }).filter(Boolean).join("\n").trim();
}
