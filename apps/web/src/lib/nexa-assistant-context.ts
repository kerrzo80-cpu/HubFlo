import {
  handleNexaAssistantMessage,
  type BlakeHistoryMessage,
  type NexaAssistantResponse,
} from "@/lib/nexa-assistant";
import { getJobs, type Job } from "@/lib/workflow-data";

type AssistantOptions = NonNullable<Parameters<typeof handleNexaAssistantMessage>[2]>;
type JobIdentity = Pick<Job, "ref" | "customer" | "site" | "description">;

const jobRefPattern = /\bJ[-\s]?\d{3,6}\b/i;

function normaliseJobRef(value: string) {
  return value.toUpperCase().replace(/\s+/, "-");
}

function extractJobRef(value: string) {
  const match = value.match(jobRefPattern)?.[0];
  return match ? normaliseJobRef(match) : undefined;
}

function mostRecentJobRef(message: string, history: BlakeHistoryMessage[]) {
  const direct = extractJobRef(message);
  if (direct) return direct;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const ref = extractJobRef(history[index]?.text ?? "");
    if (ref) return ref;
  }
  return undefined;
}

function asksForJobIdentity(message: string) {
  const lower = message.toLowerCase();
  return /\b(customer|client|customer name|client name|address|site|where|what job|which job)\b/i.test(lower)
    || /\bwho(?:'s| is)?\s+(?:that|the)\s+(?:customer|client)\b/i.test(lower)
    || /\bjob\s+(?:is\s+)?(?:that|this|it)\s+(?:for|at)\b/i.test(lower)
    || /\b(?:don't|dont|do not)\s+know\s+what\s+(?:job|j[-\s]?\d+)\b/i.test(lower);
}

function findJobByRef(jobs: JobIdentity[], ref: string) {
  const target = normaliseJobRef(ref);
  return jobs.find((job) => normaliseJobRef(job.ref) === target);
}

export function resolveJobIdentityFollowUp(
  message: string,
  history: BlakeHistoryMessage[],
  jobs: JobIdentity[],
): string | null {
  if (!asksForJobIdentity(message)) return null;

  const ref = mostRecentJobRef(message, history);
  if (!ref) return null;

  const job = findJobByRef(jobs, ref);
  if (!job) {
    return `I can see ${ref} was mentioned, but I cannot find that job in the current NeXa jobs list.`;
  }

  const siteText = job.site ? ` at ${job.site}` : "";
  const descriptionText = job.description ? ` The work is ${job.description}.` : "";
  return `${job.ref} is for ${job.customer}${siteText}.${descriptionText}`;
}

export function humaniseBookingLabel(label: string, jobs: JobIdentity[]) {
  const ref = extractJobRef(label);
  if (!ref) return label;

  const job = findJobByRef(jobs, ref);
  if (!job) return label;

  const remainder = label
    .replace(jobRefPattern, "")
    .replace(/^\s*·\s*/, "")
    .trim();
  const identity = [job.customer, job.site].filter(Boolean).join(" · ");
  const work = remainder || job.description;
  return [identity, work, `(${job.ref})`].filter(Boolean).join(" · ");
}

function humaniseSchedulingResponse(response: NexaAssistantResponse, jobs: JobIdentity[]) {
  const originalBookings = response.data?.bookings;
  if (!originalBookings?.length) return response;

  const replacements = originalBookings.map((booking) => ({
    original: booking.label,
    human: humaniseBookingLabel(booking.label, jobs),
  }));
  const bookings = originalBookings.map((booking, index) => ({
    ...booking,
    label: replacements[index]?.human ?? booking.label,
  }));
  const reply = replacements.reduce(
    (text, replacement) => text.split(replacement.original).join(replacement.human),
    response.reply,
  );

  return {
    ...response,
    reply,
    data: {
      ...response.data,
      bookings,
    },
  };
}

export async function handleContextAwareNexaAssistantMessage(
  message: string,
  actor: { id: string; name: string },
  options: AssistantOptions = {},
): Promise<NexaAssistantResponse> {
  const history = options.history ?? [];
  const jobs = getJobs();
  const jobIdentityReply = resolveJobIdentityFollowUp(message, history, jobs);

  if (jobIdentityReply) {
    return {
      reply: jobIdentityReply,
      intent: { action: "chat" },
      aiUsed: false,
    };
  }

  const response = await handleNexaAssistantMessage(message, actor, options);
  return humaniseSchedulingResponse(response, jobs);
}
