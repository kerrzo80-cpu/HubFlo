import type { HubRole } from "@/lib/access";
import {
  getApprovedMaterialsForStep,
  getModulesForFlow,
  listApprovedMaterials,
  markStepComplete,
  recordCheckAttempt,
  resolveCurrentStep,
  startOrResumeProgress,
} from "@/lib/blake-trainer/store";
import type {
  TrainerCitation,
  TrainerFlow,
  TrainerMaterial,
  TrainerProgress,
  TrainerStep,
  TrainerTurnRequest,
  TrainerTurnResponse,
} from "@/lib/blake-trainer/types";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

function normalise(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function citationsFrom(materials: TrainerMaterial[]): TrainerCitation[] {
  return materials.map((item) => ({
    materialId: item.id,
    title: item.title,
    kind: item.kind,
  }));
}

function packText(materials: TrainerMaterial[]) {
  return materials
    .map(
      (item) =>
        `[${item.kind.toUpperCase()}] ${item.title} (id:${item.id})\n${item.content}${
          item.mediaUrl ? `\nMedia: ${item.mediaUrl}` : ""
        }`,
    )
    .join("\n\n");
}

function scoreUnderstanding(answer: string, expectedPoints: string[]) {
  const text = normalise(answer);
  if (!text) return { passed: false, matched: [] as string[], score: 0 };
  const matched = expectedPoints.filter((point) => text.includes(normalise(point)));
  const score = expectedPoints.length ? matched.length / expectedPoints.length : 0;
  return { passed: score >= 0.45 || matched.length >= 2, matched, score };
}

function refuseReply(voice: boolean) {
  return voice
    ? "I don’t have that in the approved NeXa materials, so I won’t guess. Ask your manager or Brian, or stick to this module’s pack."
    : "I don’t have that in the approved NeXa materials (guides, screenshots, videos, FAQs, or company rules), so I won’t guess. Please ask your manager or Brian, or continue with this module’s approved pack.";
}

function teachReply(step: TrainerStep, materials: TrainerMaterial[], voice: boolean) {
  const lead = step.script.trim();
  if (voice) return lead;
  const sources = materials.map((item) => `• ${item.title} (${item.kind})`).join("\n");
  return `${lead}\n\nFrom approved materials:\n${sources}`;
}

function isQuestionLike(message: string) {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  if (text.includes("?")) return true;
  return /^(what|why|how|when|where|who|can|do|does|is|are|should|tell me|explain)\b/.test(text);
}

function materialsForQuestion(flow: TrainerFlow, role: HubRole, step: TrainerStep | null) {
  const stepMats = step ? getApprovedMaterialsForStep(step, role) : [];
  const flowMats = getModulesForFlow(flow).flatMap((mod) =>
    mod.steps.flatMap((item) => getApprovedMaterialsForStep(item, role)),
  );
  const roleMats = listApprovedMaterials(role);
  const ordered: TrainerMaterial[] = [];
  for (const item of [...flowMats, ...stepMats, ...roleMats]) {
    if (item.approved && !ordered.some((row) => row.id === item.id)) ordered.push(item);
  }
  return ordered;
}

function localGroundedAnswer(message: string, materials: TrainerMaterial[], voice: boolean) {
  const stop = new Set([
    "what",
    "when",
    "where",
    "which",
    "that",
    "this",
    "with",
    "from",
    "have",
    "does",
    "about",
    "into",
    "your",
    "their",
    "them",
    "then",
    "than",
    "code",
    "secret",
    "please",
    "tell",
    "give",
  ]);
  const query = normalise(message);
  const tokens = query
    .split(" ")
    .filter((token) => token.length > 3 && !stop.has(token));
  const ranked = materials
    .map((material) => {
      const hay = normalise(`${material.title} ${material.content} ${material.tags.join(" ")}`);
      const hits = tokens.filter((token) => hay.includes(token)).length;
      const titleHit = tokens.some((token) => normalise(material.title).includes(token));
      return { material, hits: hits + (titleHit ? 2 : 0) };
    })
    .filter((item) => item.hits >= 2)
    .sort((a, b) => b.hits - a.hits);

  if (!ranked.length || tokens.length === 0) {
    return {
      reply: refuseReply(voice),
      grounded: false,
      refused: true,
      citations: [] as TrainerCitation[],
    };
  }

  const top = ranked.slice(0, 2).map((item) => item.material);
  const primary = top[0]!;
  const snippet = primary.content.split(/(?<=\.)\s+/).slice(0, voice ? 2 : 4).join(" ");
  const reply = voice
    ? `${snippet} That’s from ${primary.title}.`
    : `${snippet}\n\nSource: ${top.map((item) => item.title).join("; ")}.`;

  return {
    reply,
    grounded: true,
    refused: false,
    citations: citationsFrom(top),
  };
}

async function openAiGroundedAnswer(input: {
  message: string;
  materials: TrainerMaterial[];
  step: TrainerStep;
  role: HubRole;
  voice: boolean;
}) {
  const config = getTakeoffOpenAiConfig();
  if (!config.apiKey) return null;

  const developer = [
    "You are Blake, NeXa’s voice-first staff trainer.",
    "CRITICAL: Answer ONLY using the APPROVED MATERIALS block below.",
    "If the learner’s question is not covered, refuse clearly — no guessing, no outside knowledge, no invented steps.",
    "British English. Peer tone for trades and office staff.",
    input.voice
      ? "Spoken mode: 20–60 words, short sentences, at most one follow-up question."
      : "Text mode: concise, cite material titles you used.",
    `Learner role: ${input.role}. Current step: ${input.step.title}.`,
  ].join("\n");

  const user = [
    "APPROVED MATERIALS:",
    packText(input.materials),
    "",
    `LEARNER QUESTION: ${input.message}`,
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model || "gpt-4.1-mini",
        input: [
          { role: "developer", content: [{ type: "input_text", text: developer }] },
          { role: "user", content: [{ type: "input_text", text: user }] },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    let text = data.output_text?.trim() || "";
    if (!text && Array.isArray(data.output)) {
      text = data.output
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === "output_text" || part.type === "text")
        .map((part) => part.text || "")
        .join("\n")
        .trim();
    }
    if (!text) return null;

    const refused = /not in the approved|don't have that|do not have that|won't guess|will not guess/i.test(
      text,
    );
    return {
      reply: text,
      grounded: !refused,
      refused,
      citations: refused ? [] : citationsFrom(input.materials.slice(0, 3)),
      aiUsed: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function progressSnapshot(progress: TrainerProgress) {
  const { flow, module, step } = resolveCurrentStep(progress);
  return { flow, module: module ?? undefined, step: step ?? undefined };
}

export async function runBlakeTrainerTurn(
  request: TrainerTurnRequest,
): Promise<TrainerTurnResponse> {
  const voice = Boolean(request.voice);
  const role = (request.role ?? "Engineer") as HubRole;
  const userId = request.userId?.trim() || "demo-learner";
  const userName = request.userName?.trim() || "Learner";

  let progress = startOrResumeProgress({
    flowId: request.flowId,
    userId,
    userName,
    role,
    progressId: request.progressId,
  });

  const snap = progressSnapshot(progress);
  const { flow, module, step } = snap;

  if (progress.status === "completed" && request.mode === "start") {
    return {
      reply: voice
        ? "You’ve already completed this flow. Nice work — ask Brian if you need a refresher assigned."
        : "You’ve already completed this training flow. Ask an admin if you need it reassigned.",
      grounded: true,
      refused: false,
      citations: [],
      progress,
      flow,
      module,
      step,
      phase: "complete",
      aiUsed: false,
    };
  }

  if (!module || !step) {
    return {
      reply: "This flow has no steps yet. An admin needs to add modules.",
      grounded: true,
      refused: false,
      citations: [],
      progress,
      flow,
      phase: "refuse",
      aiUsed: false,
    };
  }

  const stepMaterials = getApprovedMaterialsForStep(step, role);
  const questionMaterials = materialsForQuestion(flow, role, step);

  // Learner asks a free question mid-flow
  if (request.mode === "question" || (request.mode === "continue" && isQuestionLike(request.message || ""))) {
    const message = request.message?.trim() || "";
    if (!message) {
      return {
        reply: "Ask me anything about this step — I’ll only answer from the approved pack.",
        grounded: true,
        refused: false,
        citations: citationsFrom(stepMaterials),
        progress,
        flow,
        module,
        step,
        phase: "answer",
        aiUsed: false,
      };
    }

    // Local relevance gate first — never call the model if nothing in the pack matches.
    const local = localGroundedAnswer(message, questionMaterials, voice);
    if (local.refused) {
      return {
        reply: local.reply,
        grounded: false,
        refused: true,
        citations: [],
        progress,
        flow,
        module,
        step,
        phase: "refuse",
        aiUsed: false,
      };
    }

    const ai = await openAiGroundedAnswer({
      message,
      materials: local.citations
        .map((cite) => questionMaterials.find((item) => item.id === cite.materialId))
        .filter((item): item is TrainerMaterial => Boolean(item)),
      step,
      role,
      voice,
    });
    const result = ai ?? local;
    return {
      reply: result.reply,
      grounded: result.grounded,
      refused: result.refused,
      citations: result.citations,
      progress,
      flow,
      module,
      step,
      phase: result.refused ? "refuse" : "answer",
      aiUsed: Boolean(ai?.aiUsed),
    };
  }

  // Understanding check answer
  if (request.mode === "check_answer" || (step.kind === "check" && request.message?.trim())) {
    const answer = request.message?.trim() || "";
    progress = recordCheckAttempt(progress, step.id, answer);
    const expected = step.check?.expectedPoints ?? [];
    const scored = scoreUnderstanding(answer, expected);

    if (scored.passed) {
      progress = markStepComplete(progress, step.id, {
        checkPassed: true,
        lastAnswer: answer,
      });
      const after = progressSnapshot(progress);
      const nextLine =
        progress.status === "completed"
          ? voice
            ? "That’s solid — you’ve finished this training flow. Well done."
            : "That’s solid. You’ve completed this training flow."
          : voice
            ? `Good — that covers it. Next up: ${after.step?.title ?? "the next step"}.`
            : `Good — that covers it.\n\nNext: ${after.module?.title ?? ""} — ${after.step?.title ?? "continue"}.`;

      return {
        reply: nextLine,
        grounded: true,
        refused: false,
        citations: citationsFrom(stepMaterials),
        progress,
        flow: after.flow,
        module: after.module,
        step: after.step,
        phase: progress.status === "completed" ? "complete" : "check",
        checkResult: { passed: true, feedback: "Understanding check passed." },
        aiUsed: false,
      };
    }

    const hintMaterial = stepMaterials[0];
    const hint = hintMaterial
      ? `Hint from ${hintMaterial.title}: ${hintMaterial.content.split(/(?<=\.)\s+/).slice(0, 2).join(" ")}`
      : "Have another go using what we just covered.";

    return {
      reply: voice
        ? `Not quite yet. ${hint} Try again in your own words.`
        : `Not quite yet.\n\n${hint}\n\nTry again in your own words.`,
      grounded: true,
      refused: false,
      citations: citationsFrom(stepMaterials),
      progress,
      flow,
      module,
      step,
      phase: "check",
      checkResult: { passed: false, feedback: "Need a fuller answer from the approved materials." },
      aiUsed: false,
    };
  }

  // Start / continue teaching the current step
  if (request.mode === "start" || request.mode === "continue") {
    if (step.kind === "check") {
      return {
        reply: teachReply(step, stepMaterials, voice),
        grounded: true,
        refused: false,
        citations: citationsFrom(stepMaterials),
        progress,
        flow,
        module,
        step,
        phase: "check",
        aiUsed: false,
      };
    }

    // Advance after teaching when learner says continue / next / done
    const advanceWords = /^(next|continue|done|ok|okay|ready|got it|yes|yep|yeah)\b/i;
    const message = request.message?.trim() || "";
    if (request.mode === "continue" && message && advanceWords.test(message)) {
      progress = markStepComplete(progress, step.id);
      const after = progressSnapshot(progress);
      if (progress.status === "completed") {
        return {
          reply: voice
            ? "That’s the lot — training complete. Your completion is saved."
            : "Training complete. Your completion is saved for this flow.",
          grounded: true,
          refused: false,
          citations: [],
          progress,
          flow: after.flow,
          module: after.module,
          step: after.step,
          phase: "complete",
          aiUsed: false,
        };
      }
      const nextMaterials = after.step
        ? getApprovedMaterialsForStep(after.step, role)
        : [];
      return {
        reply: teachReply(after.step!, nextMaterials, voice),
        grounded: true,
        refused: false,
        citations: citationsFrom(nextMaterials),
        progress,
        flow: after.flow,
        module: after.module,
        step: after.step,
        phase: after.step?.kind === "check" ? "check" : "teach",
        aiUsed: false,
      };
    }

    // First delivery of current teach/demo/recap step
    if (request.mode === "start" || !message) {
      const modules = getModulesForFlow(flow);
      const intro =
        request.mode === "start"
          ? voice
            ? `Let’s start ${flow.title}. Module one: ${module.title}. `
            : `Starting **${flow.title}** (${modules.length} modules). Current module: ${module.title}.\n\n`
          : "";
      return {
        reply: `${intro}${teachReply(step, stepMaterials, voice)}`,
        grounded: true,
        refused: false,
        citations: citationsFrom(stepMaterials),
        progress,
        flow,
        module,
        step,
        phase: "teach",
        aiUsed: false,
      };
    }

    // Unrecognised continue text — treat as question against materials
    const local = localGroundedAnswer(message, questionMaterials, voice);
    if (local.refused) {
      return {
        reply: local.reply,
        grounded: false,
        refused: true,
        citations: [],
        progress,
        flow,
        module,
        step,
        phase: "refuse",
        aiUsed: false,
      };
    }
    const ai = await openAiGroundedAnswer({
      message,
      materials: local.citations
        .map((cite) => questionMaterials.find((item) => item.id === cite.materialId))
        .filter((item): item is TrainerMaterial => Boolean(item)),
      step,
      role,
      voice,
    });
    const result = ai ?? local;
    return {
      reply: result.reply,
      grounded: result.grounded,
      refused: result.refused,
      citations: result.citations,
      progress,
      flow,
      module,
      step,
      phase: result.refused ? "refuse" : "answer",
      aiUsed: Boolean(ai?.aiUsed),
    };
  }

  return {
    reply: teachReply(step, stepMaterials, voice),
    grounded: true,
    refused: false,
    citations: citationsFrom(stepMaterials),
    progress,
    flow,
    module,
    step,
    phase: "teach",
    aiUsed: false,
  };
}
