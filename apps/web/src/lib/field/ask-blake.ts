export type AskBlakeMessage = {
  role: "user" | "assistant";
  text: string;
  hasImage?: boolean;
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
  imageDataUrl?: string;
  history?: AskBlakeMessage[];
  job?: AskBlakeJobContext | null;
};

export const ASK_BLAKE_SYSTEM_PROMPT = [
  "You are Ask Blake — NeXa Field’s on-site plumbing, heating and light-joinery co-pilot for UK engineers.",
  "Help the engineer diagnose common issues from a short description and/or a site photo.",
  "Give practical step-by-step trade guidance, recommend tools/parts, and say clearly when to stop and call Gas Safe, an electrician, the office, or a specialist.",
  "",
  "Response style:",
  "- Answer the engineer’s actual question first.",
  "- Keep it concise for someone standing on site. Plain text and short dash bullets only.",
  "- Prefer UK practice, fittings and regulations language.",
  "- Never invent meter readings, gas pressures, part numbers you cannot see, or prices.",
  "- If a photo is attached, describe only what you can actually see, then give likely causes and checks.",
  "- Flag safety hazards early (gas smell, CO risk, live electrics, structural, contaminated water).",
  "- DIY homeowner advice is fine only when asked; default to professional field-engineer guidance.",
  "",
  "Prefer this shape when diagnosing:",
  "1) Likely issue",
  "2) Quick checks",
  "3) Steps",
  "4) Tools / parts",
  "5) Call for help if…",
].join("\n");

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

export function buildAskBlakeFallback(input: AskBlakeRequest) {
  const text = input.message.toLowerCase();
  const jobBit = input.job?.jobRef
    ? `On ${input.job.jobRef}${input.job.costCentre ? ` (${input.job.costCentre})` : ""}: `
    : "";

  if (includesAny(text, ["gas smell", "smell of gas", "co alarm", "carbon monoxide"])) {
    return [
      `${jobBit}Treat this as an emergency until proven otherwise.`,
      "- Do not create sparks or operate switches if you smell gas.",
      "- Ventilate if safe, isolate at the meter if competent and trained, evacuate as needed.",
      "- Call the National Gas Emergency Service on 0800 111 999 and notify the office.",
      "- Ask Blake can guide checks later — safety first now.",
    ].join("\n");
  }

  if (includesAny(text, ["leak", "dripping", "burst", "flood"])) {
    return [
      `${jobBit}Likely water leak — isolate before diagnosing.`,
      "Quick checks:",
      "- Find and close the nearest service valve / stopcock.",
      "- Note whether it is mains cold, hot, heating, or waste.",
      "- Check joints, valves, appliance connections and any recent work.",
      "Tools / parts often needed: adjustable grips, PTFE, olives/compression fittings, buckets, towels, pipe freeze if you cannot isolate.",
      "Call for help if: structural damage, uncontrolled flow after isolation, or electrics are wet.",
      input.imageDataUrl ? "Photo received — OpenAI is offline, so this is a general field fallback." : "Attach a photo of the leak source if you want a tighter read next time.",
    ].join("\n");
  }

  if (includesAny(text, ["no hot water", "hot water", "boiler", "heating", "radiator", "cylinder"])) {
    return [
      `${jobBit}Likely heating / hot-water fault.`,
      "Quick checks:",
      "- Power, programmer, room stat and boiler fault code / lockout.",
      "- System pressure (sealed systems typically ~1.0–1.5 bar cold).",
      "- Condensate run, gas supply, and any recent Tripping RCD / fuse.",
      "- For one cold radiator: bleed, lockshield, and check pump/zone valve.",
      "Tools / parts: pressure gauge awareness, bleed key, multimeter, inhibitor, valves/pump as indicated.",
      "Call for help if: gas work beyond your competence, or persistent lockout with unknown code.",
    ].join("\n");
  }

  if (includesAny(text, ["toilet", "cistern", "blocked", "blockage", "drain", "waste"])) {
    return [
      `${jobBit}Likely sanitary / waste issue.`,
      "Quick checks:",
      "- Is it one fitting or several? That separates local blockage from stack/drain.",
      "- For toilets: cistern fill, flapper/siphon, and outlet restriction.",
      "- Protect the area, then rod/auger from the nearest access — do not force chemical fixes into unknown pipework.",
      "Tools / parts: gloves, auger/rods, wet vac, pan connector, siphon/diaphragm kits.",
      "Call for help if: shared stack issue, sewage backing up from other properties, or broken soil stack.",
    ].join("\n");
  }

  if (includesAny(text, ["tap", "mixer", "shower", "pressure", "no water"])) {
    return [
      `${jobBit}Likely supply / outlet issue.`,
      "Quick checks:",
      "- Confirm isolation valves are open and filters/aerators are clear.",
      "- Compare hot vs cold and other outlets to isolate the fault.",
      "- For showers: check pump (if present), valve cartridges and scaled heads.",
      "Tools / parts: aerator key, cartridge puller, descaler, flexible hoses, isolating valves.",
      "Call for help if: no mains water at the stopcock or suspected supply authority fault.",
    ].join("\n");
  }

  return [
    `${jobBit}Ask Blake is ready — OpenAI is not connected on this pilot, so here is a practical starter.`,
    "Tell me:",
    "- What you can see / hear (or attach a photo)",
    "- Hot, cold, heating, gas, waste, or joinery?",
    "- What you have already tried",
    "",
    "I will reply with likely issue, quick checks, steps, tools/parts, and when to escalate.",
    "Examples: “combi lockout 212”, “leak under bath trap”, “no hot water after cylinder swap”.",
  ].join("\n");
}

export function buildAskBlakeUserPayload(input: AskBlakeRequest) {
  const history = (input.history ?? [])
    .slice(-10)
    .map((item) => `${item.role === "assistant" ? "Blake" : "Engineer"}: ${item.text}`)
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

  return [
    jobLines,
    "",
    history ? `Recent Ask Blake chat:\n${history}` : "No prior chat turns.",
    "",
    `Engineer message: ${input.message}`,
    input.imageDataUrl ? "A site photo is attached." : "No photo attached.",
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
