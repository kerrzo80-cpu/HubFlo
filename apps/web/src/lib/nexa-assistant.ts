import { appendAuditEvent, getClients } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { displayCompanyName } from "@/lib/branding";
import { classifyFaultReportSync } from "@/lib/faults-ai";
import { createFaultIssue } from "@/lib/faults-data";
import { guessModuleFromRoute, type FaultPriority, type FaultType } from "@/lib/faults-types";
import { getLeads } from "@/lib/lead-store";
import { resolveOpenAiApiKey } from "@/lib/openai-env";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import { pushJobToSimpro } from "@/lib/simpro-bridge";
import { getJobs, getQuotes, updateJob, type Job } from "@/lib/workflow-data";
import { getTender } from "@/lib/tenders-data";
import type { Employee, Weekday } from "@/lib/access";
import type { AccessProfile } from "@/lib/access";
import { getAccessProfile } from "@/lib/access";
import { previousCalendarMonth } from "@hubflo/domain";
import { blakeCore } from "@/lib/blake-core";
import type { BlakeExecutionContext } from "@/lib/blake-core/types";
import {
  formatBudgetPriceOffer,
  formatOpenRecordBrief,
  looksLikeFillRates,
  looksLikeOpenRecordQs,
  looksLikeRefreshRates,
  resolveOpenRecord,
  type BlakeOpenRecord,
  type BlakeScreenContext,
} from "@/lib/blake-open-record";
import {
  BLAKE_FILE_DUMP_LIMIT,
  looksLikeLastScanQuestion,
  lineOutOfBlakeScope,
  parseBlakeScopeInstruction,
  type BlakeTradeScope,
} from "@/lib/blake-trade-scope";
import {
  appendBlakeRecordMessages,
  blakeRecordKey,
  loadBlakeMemoryForScreen,
  patchBlakeRecordScope,
  recordBlakeRejectedCodes,
} from "@/lib/blake-record-memory";
import {
  continueCreateLeadCustomerChoice,
  handleCreateLeadWorkflow,
  hasActiveCreateLeadWorkflow,
  shouldContinueCreateLeadWorkflow,
} from "@/lib/blake-create-lead-workflow";

type ScheduleAssignment = {
  id: string;
  jobId: string;
  costCentreId: string;
  costCentreName: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  plannedHours: number;
  notes: string;
};

type AssistantIntent = {
  action: "availability" | "book" | "help" | "chat" | "report_fault" | "suggest_improvement" | "create_lead";
  employeeName?: string;
  dateText?: string;
  dateIso?: string;
  weekday?: string;
  jobRef?: string;
  costCentreName?: string;
  startTime?: string;
  durationHours?: number;
  faultTitle?: string;
  faultDescription?: string;
  faultModule?: string;
  faultType?: FaultType;
  faultPriority?: FaultPriority;
};

type PendingBooking = {
  kind?: "booking";
  id: string;
  createdAt: string;
  expiresAt: string;
  actorId: string;
  actorName: string;
  employeeId: string;
  employeeName: string;
  jobId: string;
  jobRef: string;
  costCentreId: string;
  costCentreName: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
};

type PendingFaultReport = {
  kind: "fault_report";
  id: string;
  createdAt: string;
  expiresAt: string;
  actorId: string;
  actorName: string;
  title: string;
  description: string;
  originalDescription: string;
  module: string;
  type: FaultType;
  priority: FaultPriority;
  sourceRoute?: string;
  sourcePage?: string;
};

type PendingBudgetPrices = {
  kind: "budget_prices";
  id: string;
  createdAt: string;
  expiresAt: string;
  actorId: string;
  actorName: string;
  tenderId: string;
  tenderName: string;
  forceRefresh: boolean;
  lineIds?: string[];
};

type PendingStore = { actions: Array<PendingBooking | PendingFaultReport | PendingBudgetPrices> };

export type BlakeHistoryMessage = {
  role: "assistant" | "user";
  text: string;
};

export type BuddyClientContext = {
  habits?: string[];
  completedWalkthroughs?: string[];
  mutedFindingIds?: string[];
  topMisses?: string[];
  workHabits?: {
    quotesWatched?: number;
    quotesSent?: number;
    avgLinesPerQuote?: number;
    avgLabourHours?: number;
  };
  quoteWatch?: {
    ref?: string;
    headline?: string;
    findings?: Array<{ severity: string; title: string; detail: string }>;
    reviewQuestions?: Array<{ severity: string; title: string; detail: string }>;
  };
};

export type NexaAssistantResponse = {
  reply: string;
  intent: AssistantIntent;
  action?: {
    id: string;
    kind: "confirm_booking" | "confirm_fault_report" | "confirm_budget_prices" | "confirm_create_lead";
    title: string;
    detail: string;
    confirmLabel: string;
  };
  data?: {
    employeeName?: string;
    date?: string;
    weekday?: string;
    workingHours?: string;
    bookings?: Array<{ startTime: string; endTime: string; label: string }>;
    faultReference?: string;
    resultCard?: BlakeResultCard;
  };
  aiUsed: boolean;
  storedMessages?: Array<{ role: "assistant" | "user"; text: string }>;
};

export type BlakeResultCard = {
  kind: "management_report" | "invoice_summary";
  title: string;
  subtitle?: string;
  metrics: Array<{
    label: string;
    value: string;
    tone?: "default" | "positive" | "warning" | "danger";
  }>;
  rows?: Array<{
    id: string;
    primary: string;
    secondary: string;
    value?: string;
    status?: string;
  }>;
};

const pendingStore = loadServerStore<PendingStore>("nexa-assistant-actions", { actions: [] });
const monthNames = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const shortWeekdays: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function refreshPendingStore() {
  const snapshot = readServerStoreSnapshot("nexa-assistant-actions") as PendingStore | null;
  if (snapshot?.actions) pendingStore.actions = snapshot.actions;
  pendingStore.actions = pendingStore.actions.filter((action) => Date.parse(action.expiresAt) > Date.now());
}

function persistPendingStore() {
  writeServerStore("nexa-assistant-actions", pendingStore);
}

function normalise(value: string) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ");
}

function parseTime(message: string) {
  const match = message.match(/\b(?:at|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseDuration(message: string) {
  const match = message.match(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value > 0 && value <= 24 ? value : undefined;
}

function isoDate(year: number, monthIndex: number, day: number) {
  const date = new Date(Date.UTC(year, monthIndex, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(message: string, now = new Date()) {
  const lower = message.toLowerCase();
  const namedWeekday = weekdays.find((weekday) => lower.includes(weekday.toLowerCase()));
  const directIso = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (directIso) {
    return { dateIso: isoDate(Number(directIso[1]), Number(directIso[2]) - 1, Number(directIso[3])), namedWeekday };
  }
  const uk = message.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (uk) {
    return { dateIso: isoDate(Number(uk[3]), Number(uk[2]) - 1, Number(uk[1])), namedWeekday };
  }
  const monthPattern = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${monthNames.join("|")})(?:\\s+(20\\d{2}))?\\b`, "i");
  const namedDate = message.match(monthPattern);
  if (namedDate) {
    const year = namedDate[3]
      ? Number(namedDate[3])
      : lower.includes("next year")
        ? now.getFullYear() + 1
        : now.getFullYear();
    return {
      dateIso: isoDate(year, monthNames.indexOf(namedDate[2]!.toLowerCase()), Number(namedDate[1])),
      namedWeekday,
    };
  }
  if (lower.includes("tomorrow")) {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    return { dateIso: isoDate(next.getFullYear(), next.getMonth(), next.getDate()), namedWeekday };
  }
  if (namedWeekday) {
    const target = weekdays.indexOf(namedWeekday);
    const next = new Date(now);
    let days = (target - next.getDay() + 7) % 7;
    if (days === 0 || lower.includes("next ")) days += 7;
    next.setDate(next.getDate() + days);
    return { dateIso: isoDate(next.getFullYear(), next.getMonth(), next.getDate()), namedWeekday };
  }
  return { dateIso: undefined, namedWeekday };
}

function weekdayForIso(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  return weekdays[date.getUTCDay()] ?? "";
}

function formatUkDate(dateIso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T12:00:00Z`));
}

function endTime(startTime: string, durationHours: number) {
  const [hours = 0, minutes = 0] = startTime.split(":").map(Number);
  const total = hours * 60 + minutes + Math.round(durationHours * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function findEmployee(employees: Employee[], query?: string) {
  if (!query) return null;
  const target = normalise(query);
  return employees.find((employee) => normalise(employee.name) === target)
    ?? employees.find((employee) => normalise(employee.name).includes(target) || target.includes(normalise(employee.name)))
    ?? employees.find((employee) => normalise(employee.name).split(" ").some((part) => target.split(" ").includes(part)))
    ?? null;
}

function extractEmployeeName(message: string, employees: Employee[]) {
  const lower = normalise(message);
  const direct = employees.find((employee) => {
    const full = normalise(employee.name);
    const first = full.split(" ")[0] ?? "";
    return lower.includes(full) || (first.length > 2 && lower.split(" ").includes(first));
  });
  return direct?.name;
}

function extractJobRef(message: string) {
  return message.match(/\bJ[-\s]?\d{3,6}\b/i)?.[0]?.toUpperCase().replace(/\s/, "-");
}

function currency(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
}

function looksLikeScheduling(message: string) {
  return /\b(available|availability|free|diary|book|schedule|assign|put)\b/i.test(message)
    || Boolean(extractJobRef(message))
    || Boolean(parseTime(message))
    || Boolean(parseDuration(message));
}

function looksLikeFaultReport(message: string) {
  // Keep this tight — broad matching was sucking normal chat into the fault AI path.
  return /\b(report (a )?(fault|bug|problem|issue)|add a fault|log a fault|suggest( an)? improvement|raise a (fault|bug|ticket)|faults? & improvements?)\b/i.test(
    message,
  );
}

function deterministicIntent(message: string, employees: Employee[], now = new Date()): AssistantIntent {
  const date = parseDate(message, now);
  const lower = message.toLowerCase();
  if (looksLikeFaultReport(message) && !looksLikeScheduling(message)) {
    const improvement = /\b(improvement|enhance|feature|suggest)\b/i.test(message);
    return {
      action: improvement ? "suggest_improvement" : "report_fault",
      faultDescription: message,
      faultModule: guessModuleFromRoute(undefined, message),
      faultType: improvement ? "improvement" : "fault",
    };
  }
  const scheduling = looksLikeScheduling(message);
  return {
    action: !scheduling
      ? "chat"
      : /\b(book|schedule|assign|put)\b/i.test(message)
        ? "book"
        : /\b(available|availability|free|diary)\b/i.test(message)
          ? "availability"
          : "help",
    employeeName: extractEmployeeName(message, employees),
    dateText: message,
    dateIso: date.dateIso,
    weekday: date.namedWeekday,
    jobRef: extractJobRef(message),
    startTime: parseTime(message),
    durationHours: parseDuration(message),
    costCentreName: lower.match(/\b(?:cost centre|cost center)\s+["']?([^,.;]+)["']?/i)?.[1]?.trim(),
  };
}

async function aiIntent(message: string, employees: Employee[], now: Date): Promise<AssistantIntent | null> {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) return null;
  const model = process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim()
    || process.env.NEXA_TAKEOFF_OPENAI_MODEL?.trim()
    || "gpt-4.1-mini";
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: `Extract a Blake intent. Use report_fault or suggest_improvement when the user wants to log a NeXa product fault/improvement. Use scheduling actions only for diaries/bookings. Otherwise use action "chat". Today is ${now.toISOString().slice(0, 10)}. UK date order is day/month/year. Employees: ${employees.map((employee) => employee.name).join(", ")}. Never silently repair a weekday/date mismatch.`,
            }],
          },
          { role: "user", content: [{ type: "input_text", text: message }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "nexa_schedule_intent",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                action: {
                  type: "string",
                  enum: ["availability", "book", "help", "chat", "report_fault", "suggest_improvement"],
                },
                employeeName: { type: ["string", "null"] },
                dateText: { type: ["string", "null"] },
                dateIso: { type: ["string", "null"] },
                weekday: { type: ["string", "null"] },
                jobRef: { type: ["string", "null"] },
                costCentreName: { type: ["string", "null"] },
                startTime: { type: ["string", "null"] },
                durationHours: { type: ["number", "null"] },
                faultDescription: { type: ["string", "null"] },
              },
              required: [
                "action",
                "employeeName",
                "dateText",
                "dateIso",
                "weekday",
                "jobRef",
                "costCentreName",
                "startTime",
                "durationHours",
                "faultDescription",
              ],
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const result = await response.json() as {
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text = result.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      action: parsed.action as AssistantIntent["action"],
      employeeName: typeof parsed.employeeName === "string" ? parsed.employeeName : undefined,
      dateText: typeof parsed.dateText === "string" ? parsed.dateText : undefined,
      dateIso: typeof parsed.dateIso === "string" ? parsed.dateIso : undefined,
      weekday: typeof parsed.weekday === "string" ? parsed.weekday : undefined,
      jobRef: typeof parsed.jobRef === "string" ? parsed.jobRef : undefined,
      costCentreName: typeof parsed.costCentreName === "string" ? parsed.costCentreName : undefined,
      startTime: typeof parsed.startTime === "string" ? parsed.startTime : undefined,
      durationHours: typeof parsed.durationHours === "number" ? parsed.durationHours : undefined,
      faultDescription: typeof parsed.faultDescription === "string" ? parsed.faultDescription : undefined,
    };
  } catch {
    return null;
  }
}

function scheduleForEmployee(employee: Employee, dateIso: string) {
  const hubState = getHubDetailState();
  const plans = (hubState.jobSchedulePlans ?? {}) as Record<string, ScheduleAssignment[]>;
  const jobById = new Map(getJobs().map((job) => [job.id, job]));
  const jobBookings = Object.values(plans)
    .flat()
    .filter((item) => item.employeeId === employee.id && item.startDate === dateIso)
    .map((item) => ({
      startTime: item.startTime,
      endTime: item.endTime,
      label: `${jobById.get(item.jobId)?.ref ?? "Job"} · ${item.costCentreName}`,
    }));
  const rootJobBookings = getJobs()
    .filter((job) => job.manager === employee.name && job.scheduledDate === dateIso && job.scheduledTime)
    .filter((job) => !jobBookings.some((booking) => booking.label.startsWith(job.ref)))
    .map((job) => ({
      startTime: job.scheduledTime!,
      endTime: endTime(job.scheduledTime!, job.scheduledDurationHours ?? 1),
      label: `${job.ref} · ${job.description}`,
    }));
  const surveys = getLeads()
    .filter((lead) => lead.surveyor === employee.name && lead.surveyDate === dateIso && lead.surveyTime && lead.status !== "Lost")
    .map((lead) => ({
      startTime: lead.surveyTime,
      endTime: endTime(lead.surveyTime, 1),
      label: `${lead.ref} · survey for ${lead.customerName}`,
    }));
  return [...jobBookings, ...rootJobBookings, ...surveys]
    .sort((first, second) => first.startTime.localeCompare(second.startTime));
}

function overlap(start: string, end: string, bookingStart: string, bookingEnd: string) {
  return start < bookingEnd && end > bookingStart;
}

function resolveCostCentre(job: Job, requested?: string) {
  const hubState = getHubDetailState();
  const centres = ((hubState.jobCostCentres ?? {}) as Record<string, Array<{ id: string; name: string }>>)[job.id] ?? [];
  if (requested) {
    const target = normalise(requested);
    const match = centres.find((centre) => normalise(centre.name).includes(target) || target.includes(normalise(centre.name)));
    if (match) return { centre: match, choices: centres };
  }
  return { centre: centres.length === 1 ? centres[0] : undefined, choices: centres };
}

function buildWorkspaceContext() {
  const hubState = getHubDetailState();
  const employees = (hubState.employees ?? []) as Employee[];
  const quotes = getQuotes();
  const jobs = getJobs();
  const leads = getLeads();
  const clients = getClients();
  const quoteFollowUps = quotes.filter((quote) => ["Draft", "Sent"].includes(quote.status)).slice(0, 12);
  const openJobs = jobs.filter((job) => !["Complete", "Completed", "Cancelled", "Invoiced"].includes(job.status));
  const unscheduled = openJobs.filter((job) => !job.scheduledDate).slice(0, 10);
  const labourOverruns = jobs
    .filter((job) => typeof job.labourCostVariance === "number" && job.labourCostVariance > 0)
    .slice(0, 8);
  const salesThisMonth = quotes
    .filter((quote) => ["Accepted", "Converted"].includes(quote.status))
    .reduce((sum, quote) => sum + (quote.value || 0), 0);

  return {
    summary: {
      customers: clients.length,
      employees: employees.filter((employee) => employee.login?.enabled !== false).length,
      leads: leads.length,
      quotes: quotes.length,
      jobs: jobs.length,
      openJobs: openJobs.length,
      acceptedSalesValue: salesThisMonth,
    },
    employees: employees.slice(0, 40).map((employee) => ({
      name: employee.name,
      role: employee.role,
    })),
    quoteFollowUps: quoteFollowUps.map((quote) => ({
      ref: quote.ref,
      customer: quote.customer,
      status: quote.status,
      value: quote.value,
      next: quote.next,
      due: quote.due,
    })),
    openJobs: openJobs.slice(0, 20).map((job) => ({
      ref: job.ref,
      customer: job.customer,
      status: job.status,
      manager: job.manager,
      scheduledDate: job.scheduledDate,
      value: job.value,
      next: job.next,
    })),
    unscheduledJobs: unscheduled.map((job) => ({ ref: job.ref, customer: job.customer, description: job.description })),
    labourOverruns: labourOverruns.map((job) => ({
      ref: job.ref,
      customer: job.customer,
      variance: job.labourCostVariance,
      planned: job.scheduledDurationHours,
      actual: job.actualDurationHours,
    })),
    recentLeads: leads.slice(0, 12).map((lead) => ({
      ref: lead.ref,
      customer: lead.customerName,
      status: lead.status,
      next: lead.next,
    })),
  };
}

function deterministicBusinessReply(message: string): string | null {
  const lower = message.toLowerCase();
  const context = buildWorkspaceContext();

  if (/\b(hello|hi|hey|good (morning|afternoon|evening))\b/i.test(message)) {
    return `Hi — I'm Blake, your NeXa business assistant. I can check the diary, quote pipeline, jobs, tenders and follow-ups using live NeXa data. What do you need?`;
  }

  if (/\b(help|what can you)\b/i.test(message)) {
    return [
      "I can help with live NeXa questions such as:",
      "• When is an engineer available?",
      "• Which quotes need follow-up?",
      "• Which jobs are open or unscheduled?",
      "• Which jobs are over their labour allowance?",
      "• Open a tender or job and ask me to walk through the BoQ, or “price this bill” (rate library + Blake guides — confirm before I write rates).",
      "• Draft a booking — I will always ask you to confirm before writing the diary.",
    ].join("\n");
  }

  if (/\b(quote|quotation).*(follow|outstanding|pipeline|not followed)|follow.?up.*quote/i.test(lower)
    || /\bwhich quotes\b/i.test(lower)) {
    if (!context.quoteFollowUps.length) return "There are no draft or sent quotes waiting for follow-up in NeXa right now.";
    return `Quotes needing attention:\n${context.quoteFollowUps
      .map((quote) => `• ${quote.ref} · ${quote.customer} · ${quote.status} · ${currency(quote.value)} · ${quote.next || quote.due}`)
      .join("\n")}`;
  }

  if (/\bunscheduled|not (been )?allocated|no (labour|schedule)|which jobs.*(free|open)/i.test(lower)) {
    if (!context.unscheduledJobs.length) return "Every open job currently has a scheduled date in NeXa.";
    return `Open jobs without a scheduled date:\n${context.unscheduledJobs
      .map((job) => `• ${job.ref} · ${job.customer} · ${job.description}`)
      .join("\n")}`;
  }

  if (/\bover.*(labour|hours)|labour.*(over|variance)|running over/i.test(lower)) {
    if (!context.labourOverruns.length) return "No jobs currently show a positive labour cost variance in NeXa.";
    return `Jobs with labour over allowance:\n${context.labourOverruns
      .map((job) => `• ${job.ref} · ${job.customer} · variance ${currency(job.variance || 0)} (planned ${job.planned ?? "?"}h / actual ${job.actual ?? "?"}h)`)
      .join("\n")}`;
  }

  if (/\b(sales|turnover|pipeline|how (are|is) (we|sales))\b/i.test(lower)) {
    return [
      `Live NeXa snapshot:`,
      `• ${context.summary.quotes} quotes · ${context.summary.openJobs} open jobs · ${context.summary.leads} leads`,
      `• Accepted/converted quote value currently held: ${currency(context.summary.acceptedSalesValue)}`,
      `• ${context.quoteFollowUps.length} quotes still in Draft/Sent follow-up`,
      `• ${context.unscheduledJobs.length} open jobs without a schedule date`,
    ].join("\n");
  }

  if (/\b(how many|count).*(job|quote|lead|customer|employee)/i.test(lower)) {
    return `NeXa currently has ${context.summary.customers} customers, ${context.summary.employees} employees, ${context.summary.leads} leads, ${context.summary.quotes} quotes and ${context.summary.jobs} jobs (${context.summary.openJobs} open).`;
  }

  return null;
}

async function conversationalReply(
  message: string,
  history: BlakeHistoryMessage[],
  actorName: string,
  buddyContext?: BuddyClientContext,
  openRecord?: BlakeOpenRecord,
  extras?: { scope?: BlakeTradeScope; lastScanSummary?: string },
  coreContext?: BlakeExecutionContext,
): Promise<{ reply: string; aiUsed: boolean }> {
  const deterministic = deterministicBusinessReply(message);
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    return {
      reply: deterministic
        ?? "I can answer from live NeXa data about quotes, jobs, follow-ups and the diary. Ask a specific NeXa question, or check that NEXA_OPENAI_API_KEY is set in Render for freer conversation.",
      aiUsed: false,
    };
  }

  const model = process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim()
    || process.env.NEXA_TAKEOFF_OPENAI_MODEL?.trim()
    || "gpt-4.1-mini";
  const context = buildWorkspaceContext();
  const recentHistory = history.slice(-16).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: item.text,
  }));

  try {
    const system = [
      `You are Blake, the universal AI operating layer inside NeXa for ${displayCompanyName(getHubDetailState().businessSettings)}.`,
      "Talk naturally like a capable ChatGPT colleague. Understand follow-up questions from conversation; do not force users into forms or repeat questions they have answered.",
      "Use the available NeXa tools whenever live records, figures, reports, invoices, profitability, customers or schedules are needed. Do not guess live facts from general knowledge.",
      "Explain tool results in clear business English and answer the actual question. If records lack reliable cost data, say so explicitly rather than presenting a false margin.",
      "Read actions may run immediately. Never claim a write happened unless a confirmed NeXa capability reports success; explain that operational writes require confirmation.",
      "If the user is looking at a tender, job or takeoff, discuss that record first. Honour scope instructions and preserve conversational context.",
      "Be useful beyond database lookups too: reason, draft, compare, explain and advise as ChatGPT would, while keeping NeXa facts grounded.",
      BLAKE_FILE_DUMP_LIMIT,
      `Today is ${new Date().toISOString().slice(0, 10)} and UK date order applies. The current user is ${actorName}.`,
      buddyContext ? `Working preferences:\n${JSON.stringify(buddyContext)}` : "",
      openRecord && (openRecord.tender || openRecord.job || openRecord.takeoff) ? `Open record:\n${JSON.stringify(openRecord)}` : "",
      extras?.scope ? `Confirmed scope:\n${JSON.stringify(extras.scope)}` : "",
      extras?.lastScanSummary ? `Last drawing scan:\n${extras.lastScanSummary}` : "",
      `Compact workspace orientation (use tools for detailed facts):\n${JSON.stringify(context.summary)}`,
    ].filter(Boolean).join("\n");
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: system },
      ...recentHistory,
      { role: "user", content: message },
    ];
    const definitions = coreContext
      ? blakeCore.definitions().filter((item) => item.mode === "read" && item.requiredPermissions.every((permission) => coreContext.access[permission as keyof AccessProfile] === true))
      : [];
    const tools = definitions.map((item) => ({
      type: "function",
      function: { name: item.name, description: item.description, parameters: item.inputSchema },
    }));

    for (let turn = 0; turn < 5; turn += 1) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.2, messages, tools: tools.length ? tools : undefined, tool_choice: tools.length ? "auto" : undefined }),
      });
      if (!response.ok) return { reply: deterministic ?? "Blake could not reach the AI service just now. No NeXa data was changed.", aiUsed: false };
      const body = await response.json() as {
        choices?: Array<{ message?: { role?: string; content?: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> } }>;
      };
      const assistant = body.choices?.[0]?.message;
      if (!assistant) return { reply: deterministic ?? "I could not form a reply from the live workspace.", aiUsed: false };
      const calls = assistant.tool_calls ?? [];
      if (!calls.length) {
        const reply = assistant.content?.trim();
        return { reply: reply || deterministic || "I could not form a reply from the live workspace.", aiUsed: Boolean(reply) };
      }
      messages.push({ role: "assistant", content: assistant.content ?? null, tool_calls: calls });
      for (const call of calls) {
        let input: unknown = {};
        try { input = JSON.parse(call.function.arguments || "{}"); } catch { input = {}; }
        const result = coreContext
          ? await blakeCore.execute(call.function.name, input, coreContext)
          : { ok: false, error: { message: "No trusted NeXa context is available." } };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return { reply: "I reached the tool-call limit for that request. Nothing was changed; please narrow the question slightly.", aiUsed: true };
  } catch {
    return {
      reply: deterministic ?? "Blake hit a temporary error talking to the AI service. Your NeXa data was not changed.",
      aiUsed: false,
    };
  }
}

async function handleSchedulingMessage(
  message: string,
  actor: { id: string; name: string },
  now: Date,
): Promise<NexaAssistantResponse> {
  const hubState = getHubDetailState();
  const employees = (hubState.employees ?? []) as Employee[];
  const deterministic = deterministicIntent(message, employees, now);
  const extracted = await aiIntent(message, employees, now);
  const intent: AssistantIntent = {
    ...deterministic,
    ...Object.fromEntries(Object.entries(extracted ?? {}).filter(([, value]) => value !== undefined)),
  };

  intent.employeeName = deterministic.employeeName;
  intent.jobRef = deterministic.jobRef;
  const localDate = parseDate(message, now);
  if (localDate.dateIso) intent.dateIso = localDate.dateIso;
  if (localDate.namedWeekday) intent.weekday = localDate.namedWeekday;
  if (intent.action === "chat") intent.action = deterministic.action === "chat" ? "help" : deterministic.action;
  const employee = findEmployee(employees, intent.employeeName);

  if (!employee) {
    return {
      reply: employees.length
        ? `I could not identify the employee. Try a name such as ${employees.slice(0, 3).map((item) => item.name).join(", ")}.`
        : "No active employee cards are available. Add the employee in People before checking the diary.",
      intent,
      aiUsed: Boolean(extracted),
    };
  }
  intent.employeeName = employee.name;
  if (!intent.dateIso) {
    return { reply: `What date should I check for ${employee.name}?`, intent, aiUsed: Boolean(extracted) };
  }

  const actualWeekday = weekdayForIso(intent.dateIso);
  if (intent.weekday && normalise(intent.weekday) !== normalise(actualWeekday)) {
    return {
      reply: `${formatUkDate(intent.dateIso)} is a ${actualWeekday}, not a ${intent.weekday}. I have not checked or booked a different date. Please confirm which one you mean.`,
      intent,
      data: { employeeName: employee.name, date: intent.dateIso, weekday: actualWeekday },
      aiUsed: Boolean(extracted),
    };
  }

  const weekdayKey = shortWeekdays[new Date(`${intent.dateIso}T12:00:00Z`).getUTCDay()]!;
  const working = employee.profile?.availability?.[weekdayKey];
  const bookings = scheduleForEmployee(employee, intent.dateIso);
  if (!working?.active) {
    return {
      reply: `${employee.name} is marked unavailable on ${formatUkDate(intent.dateIso)}.`,
      intent,
      data: { employeeName: employee.name, date: intent.dateIso, weekday: actualWeekday, bookings },
      aiUsed: Boolean(extracted),
    };
  }

  if (intent.action !== "book") {
    const bookingText = bookings.length
      ? `Existing diary entries: ${bookings.map((item) => `${item.startTime}-${item.endTime} ${item.label}`).join("; ")}.`
      : "There are no job or survey bookings in the NeXa diary.";
    return {
      reply: `${employee.name} works ${working.from}-${working.to} on ${formatUkDate(intent.dateIso)}. ${bookingText}`,
      intent,
      data: {
        employeeName: employee.name,
        date: intent.dateIso,
        weekday: actualWeekday,
        workingHours: `${working.from}-${working.to}`,
        bookings,
      },
      aiUsed: Boolean(extracted),
    };
  }

  const job = getJobs().find((item) => normalise(item.ref) === normalise(intent.jobRef ?? ""));
  if (!job) {
    return { reply: `Which job should I schedule ${employee.name} to? Include a job reference such as J-1052.`, intent, aiUsed: Boolean(extracted) };
  }
  const costCentreResult = resolveCostCentre(job, intent.costCentreName);
  if (!costCentreResult.centre) {
    const choices = costCentreResult.choices.map((centre) => centre.name).join(", ");
    return {
      reply: choices
        ? `Which cost centre on ${job.ref} should I use? Available choices: ${choices}.`
        : `${job.ref} has no cost centres yet. Add one before scheduling work.`,
      intent,
      aiUsed: Boolean(extracted),
    };
  }
  if (!intent.startTime || !intent.durationHours) {
    return {
      reply: `What start time and duration should I use? For example: “Book ${employee.name} on ${job.ref} at 08:00 for 4 hours.”`,
      intent,
      aiUsed: Boolean(extracted),
    };
  }
  const finish = endTime(intent.startTime, intent.durationHours);
  if (intent.startTime < working.from || finish > working.to) {
    return {
      reply: `${employee.name} is only available ${working.from}-${working.to}; ${intent.startTime}-${finish} falls outside those hours.`,
      intent,
      aiUsed: Boolean(extracted),
    };
  }
  const clash = bookings.find((booking) => overlap(intent.startTime!, finish, booking.startTime, booking.endTime));
  if (clash) {
    return {
      reply: `${employee.name} cannot be booked ${intent.startTime}-${finish}; it clashes with ${clash.label} (${clash.startTime}-${clash.endTime}).`,
      intent,
      data: { employeeName: employee.name, date: intent.dateIso, weekday: actualWeekday, bookings },
      aiUsed: Boolean(extracted),
    };
  }

  refreshPendingStore();
  const pending: PendingBooking = {
    id: `assistant-action-${crypto.randomUUID()}`,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    employeeId: employee.id,
    employeeName: employee.name,
    jobId: job.id,
    jobRef: job.ref,
    costCentreId: costCentreResult.centre.id,
    costCentreName: costCentreResult.centre.name,
    date: intent.dateIso,
    startTime: intent.startTime,
    endTime: finish,
    durationHours: intent.durationHours,
  };
  pendingStore.actions = [pending, ...pendingStore.actions.filter((action) => action.id !== pending.id)];
  persistPendingStore();

  return {
    reply: `I found a clear slot. Review this booking before I write it to the live diary.`,
    intent,
    action: {
      id: pending.id,
      kind: "confirm_booking",
      title: `${employee.name} · ${job.ref}`,
      detail: `${formatUkDate(intent.dateIso)}, ${intent.startTime}-${finish} · ${costCentreResult.centre.name}`,
      confirmLabel: "Confirm booking",
    },
    data: { employeeName: employee.name, date: intent.dateIso, weekday: actualWeekday, bookings },
    aiUsed: Boolean(extracted),
  };
}

async function handleFaultReportMessage(
  message: string,
  actor: { id: string; name: string },
  options: { sourceRoute?: string; sourcePage?: string } = {},
): Promise<NexaAssistantResponse> {
  // Keep this local/heuristic so "Report a problem" never waits on OpenAI
  // (live was timing out / 502ing while classifying).
  const classified = classifyFaultReportSync({
    description: message,
    sourceRoute: options.sourceRoute,
    sourcePage: options.sourcePage,
  });
  refreshPendingStore();
  const pending: PendingFaultReport = {
    kind: "fault_report",
    id: `fault-pending-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    title: classified.title,
    description: classified.aiDescription || message,
    originalDescription: message,
    module: classified.module,
    type: classified.type,
    priority: classified.priority,
    sourceRoute: options.sourceRoute,
    sourcePage: options.sourcePage,
  };
  pendingStore.actions = [pending, ...pendingStore.actions];
  persistPendingStore();
  return {
    reply: [
      "I can add this to Faults & Improvements.",
      "",
      `${classified.title}`,
      `${classified.module} · ${classified.type.replace("_", " ")} · ${classified.priority} priority`,
      "",
      "Original wording is kept. Confirm to create the NX reference.",
    ].join("\n"),
    intent: {
      action: classified.type === "improvement" || classified.type === "new_feature" ? "suggest_improvement" : "report_fault",
      faultTitle: classified.title,
      faultDescription: message,
      faultModule: classified.module,
      faultType: classified.type,
      faultPriority: classified.priority,
    },
    action: {
      id: pending.id,
      kind: "confirm_fault_report",
      title: classified.title,
      detail: `${classified.module} · ${classified.type} · ${classified.priority}`,
      confirmLabel: "Add to Faults",
    },
    aiUsed: false,
  };
}

function offerBudgetPrices(
  record: BlakeOpenRecord,
  actor: { id: string; name: string },
  message: string,
  now: Date,
  scope?: BlakeTradeScope,
): NexaAssistantResponse {
  const forceRefresh = looksLikeRefreshRates(message);
  const offer = formatBudgetPriceOffer(record, forceRefresh);
  if (!offer.canApply || !record.tender) {
    return { reply: offer.reply, intent: { action: "chat" }, aiUsed: false };
  }

  const tender = getTender(record.tender.id);
  const lineIds = tender
    ? tender.boqLines
      .filter((line) => line.kind === "measured")
      .filter((line) => !lineOutOfBlakeScope(line.description, line.section, scope))
      .map((line) => line.id)
    : undefined;
  const skipped = tender && lineIds
    ? tender.boqLines.filter((line) => line.kind === "measured").length - lineIds.length
    : 0;
  const scopeNote = skipped > 0
    ? `\nLeaving ${skipped} electrical / ventilation / out-of-scope line(s) blank — you told me that is not our trade.`
    : scope?.notes?.length
      ? `\nScope: ${scope.notes.slice(-2).join(" ")}`
      : "";

  refreshPendingStore();
  const pending: PendingBudgetPrices = {
    kind: "budget_prices",
    id: `assistant-action-${crypto.randomUUID()}`,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    tenderId: record.tender.id,
    tenderName: record.tender.name,
    forceRefresh,
    lineIds: lineIds?.length ? lineIds : undefined,
  };
  pendingStore.actions = [pending, ...pendingStore.actions.filter((action) => action.id !== pending.id)];
  persistPendingStore();

  return {
    reply: `${offer.reply}${scopeNote}\nGuide rates only — not a firm tender. Confirm and I’ll write them onto this bill.`,
    intent: { action: "chat" },
    action: {
      id: pending.id,
      kind: "confirm_budget_prices",
      title: forceRefresh ? `Refresh guides · ${record.tender.name}` : `Price BoQ · ${record.tender.name}`,
      detail: skipped > 0 ? `${offer.detail} · skip ${skipped} out of scope` : offer.detail,
      confirmLabel: forceRefresh ? "Refresh Blake budget prices" : "Apply Blake budget prices",
    },
    aiUsed: false,
  };
}

function chatKeysForScreen(screen?: BlakeScreenContext, openRecord?: BlakeOpenRecord): string[] {
  const keys = [
    screen?.takeoffId ? blakeRecordKey("takeoff", screen.takeoffId) : "",
    openRecord?.takeoff?.id ? blakeRecordKey("takeoff", openRecord.takeoff.id) : "",
    screen?.tenderId ? blakeRecordKey("tender", screen.tenderId) : "",
    openRecord?.tender?.id ? blakeRecordKey("tender", openRecord.tender.id) : "",
    screen?.jobId ? blakeRecordKey("job", screen.jobId) : "",
    openRecord?.job?.id ? blakeRecordKey("job", openRecord.job.id) : "",
  ].filter(Boolean);
  return [...new Set(keys)];
}

function persistChatTurn(keys: string[], role: "user" | "assistant", text: string) {
  for (const key of keys) {
    appendBlakeRecordMessages(key, [{ role, text }]);
  }
}

export async function handleNexaAssistantMessage(
  message: string,
  actor: { id: string; name: string; tenantId?: string; canCreateLead?: boolean; access?: AccessProfile; channel?: "web_text" | "web_voice" | "mobile_text" | "mobile_voice" },
  options: {
    history?: BlakeHistoryMessage[];
    buddyContext?: BuddyClientContext;
    screenContext?: BlakeScreenContext;
    now?: Date;
    sourceRoute?: string;
    sourcePage?: string;
    conversationId?: string;
  } = {},
): Promise<NexaAssistantResponse> {
  const now = options.now ?? new Date();
  const hubState = getHubDetailState();
  const employees = (hubState.employees ?? []) as Employee[];
  const leadContext = {
    actorId: actor.id,
    actorName: actor.name,
    tenantId: actor.tenantId ?? "default",
    canCreateLead: actor.canCreateLead === true,
    workflowRunId: "pending",
    conversationId: options.conversationId,
  };
  if (hasActiveCreateLeadWorkflow(leadContext) && shouldContinueCreateLeadWorkflow(message, leadContext)) {
    const choice = await continueCreateLeadCustomerChoice(message, leadContext);
    const workflow = choice ?? await handleCreateLeadWorkflow(message, leadContext);
    if (workflow) return { ...workflow, intent: { action: "create_lead" } } as NexaAssistantResponse;
  }
  if (/\b(create|start|add|new)\b.*\blead\b|\bnew lead\b/i.test(message)) {
    if (!leadContext.canCreateLead) {
      return { reply: "You don't have permission to create leads.", intent: { action: "create_lead" }, aiUsed: false };
    }
    const workflow = await handleCreateLeadWorkflow(message, leadContext, true);
    if (workflow) return { ...workflow, intent: { action: "create_lead" } } as NexaAssistantResponse;
  }
  const coreAccess = actor.access ?? getAccessProfile("Read-only", { canCreateLead: actor.canCreateLead === true });
  const coreContext = {
    actor: { id: actor.id, name: actor.name, tenantId: actor.tenantId ?? "default", channel: actor.channel ?? "web_text" },
    access: coreAccess,
  };
  if (/\b(profit\s*(?:and|&)?\s*loss|p\s*&\s*l|management report|sales|turnover)\b/i.test(message) && /\blast month\b/i.test(message)) {
    const period = previousCalendarMonth(now);
    const result = await blakeCore.execute<{
      revenue: number; directCost: number; grossProfit: number; grossMarginPercent: number;
      acceptedQuoteValue: number; invoicesIssued: number; jobsCompleted: number; basis: string;
    }>("build_management_report", period, coreContext);
    if (!result.ok || !result.data) return { reply: result.error?.message || "Blake could not build that report.", intent: { action: "chat" }, aiUsed: false };
    const report = result.data;
    return {
      reply: [
        `Management report · ${formatUkDate(period.from)} to ${formatUkDate(period.to)}`,
        `• Revenue: ${currency(report.revenue)}`,
        `• Direct cost: ${currency(report.directCost)}`,
        `• Gross profit: ${currency(report.grossProfit)} (${report.grossMarginPercent}%)`,
        `• Accepted quote value: ${currency(report.acceptedQuoteValue)}`,
        `• ${report.invoicesIssued} invoices issued · ${report.jobsCompleted} jobs completed`,
        report.basis,
      ].join("\n"),
      intent: { action: "chat" },
      data: {
        resultCard: {
          kind: "management_report",
          title: "Management report",
          subtitle: `${formatUkDate(period.from)} to ${formatUkDate(period.to)}`,
          metrics: [
            { label: "Revenue", value: currency(report.revenue) },
            { label: "Gross profit", value: currency(report.grossProfit), tone: report.grossProfit >= 0 ? "positive" : "danger" },
            { label: "Gross margin", value: `${report.grossMarginPercent}%`, tone: report.grossMarginPercent >= 0 ? "positive" : "danger" },
            { label: "Accepted quotes", value: currency(report.acceptedQuoteValue) },
          ],
        },
      },
      aiUsed: false,
    };
  }
  const invoiceReadRequest = /\b(show|list|find|which|what|how much|total|owed|owing|outstanding|overdue|unpaid|paid)\b/i.test(message)
    && /\b(invoice|invoices|owed|owing|outstanding|overdue|debtors)\b/i.test(message);
  if (invoiceReadRequest) {
    const lower = message.toLowerCase();
    const status: "all" | "unpaid" | "overdue" | "paid" = /\boverdue\b/.test(lower)
      ? "overdue"
      : /\b(unpaid|owed|owing|outstanding|debtors)\b/.test(lower)
        ? "unpaid"
        : /\bpaid\b/.test(lower)
          ? "paid"
          : "all";
    const customerMatch = message.match(/\b(?:for|customer)\s+(.+?)(?:[?.]|$)/i);
    const customer = customerMatch?.[1]?.trim();
    const result = await blakeCore.execute<{
      count: number;
      total: number;
      owed: number;
      rows: Array<{ id: string; ref: string; customer: string; title: string; status: string; issuedDate: string; dueDate: string; total: number; owed: number }>;
    }>("list_invoices", { status, customer, asAt: now.toISOString().slice(0, 10), limit: 20 }, coreContext);
    if (!result.ok || !result.data) {
      return { reply: result.error?.message || "Blake could not read the invoices.", intent: { action: "chat" }, aiUsed: false };
    }
    const invoices = result.data;
    const statusLabel = status === "all" ? "invoices" : `${status} invoices`;
    return {
      reply: invoices.count
        ? `I found ${invoices.count} ${statusLabel}${customer ? ` for ${customer}` : ""}. Their total value is ${currency(invoices.total)}${status === "paid" ? "." : ` and ${currency(invoices.owed)} remains owed.`}`
        : `I could not find any ${statusLabel}${customer ? ` for ${customer}` : ""}.`,
      intent: { action: "chat" },
      data: {
        resultCard: {
          kind: "invoice_summary",
          title: status === "all" ? "Invoices" : `${status[0].toUpperCase()}${status.slice(1)} invoices`,
          subtitle: customer || `${invoices.count} record${invoices.count === 1 ? "" : "s"}`,
          metrics: [
            { label: "Invoices", value: String(invoices.count) },
            { label: "Total value", value: currency(invoices.total) },
            { label: "Amount owed", value: currency(invoices.owed), tone: invoices.owed > 0 ? "warning" : "positive" },
          ],
          rows: invoices.rows.map((invoice) => ({
            id: invoice.id || invoice.ref,
            primary: `${invoice.ref} · ${invoice.customer}`,
            secondary: [invoice.title, invoice.dueDate ? `Due ${formatUkDate(invoice.dueDate)}` : ""].filter(Boolean).join(" · "),
            value: currency(status === "paid" ? invoice.total : invoice.owed || invoice.total),
            status: invoice.status,
          })),
        },
      },
      aiUsed: false,
    };
  }
  if (/\b(booked in|on the system|find|search|look up|do we have)\b/i.test(message) && actor.access?.showCore) {
    const query = message
      .replace(/\b(is|are|do we have|booked in|on the system|find|search|look up|please|can you|for me)\b/gi, " ")
      .replace(/[?.,]/g, " ").replace(/\s+/g, " ").trim();
    if (query.length >= 3) {
      const result = await blakeCore.execute<{ matches: Array<{ type: string; ref?: string; title: string; detail: string; status?: string }> }>("search_nexa_records", { query, limit: 10 }, coreContext);
      if (result.ok && result.data) {
        return {
          reply: result.data.matches.length
            ? `I found ${result.data.matches.length} matching NeXa record(s):\n${result.data.matches.map((item) => `• ${item.type}${item.ref ? ` ${item.ref}` : ""} · ${item.title} · ${item.detail}${item.status ? ` · ${item.status}` : ""}`).join("\n")}`
            : `I could not find a NeXa client, site, lead, quote, job or invoice matching “${query}”.`,
          intent: { action: "chat" }, aiUsed: false,
        };
      }
    }
  }
  const deterministic = deterministicIntent(message, employees, now);
  const openRecord = resolveOpenRecord(options.screenContext, message);
  const chatKeys = chatKeysForScreen(options.screenContext, openRecord);
  const memory = loadBlakeMemoryForScreen({
    tenderId: options.screenContext?.tenderId || openRecord.tender?.id,
    jobId: options.screenContext?.jobId || openRecord.job?.id,
    takeoffId: options.screenContext?.takeoffId || openRecord.takeoff?.id,
  });
  const parsed = parseBlakeScopeInstruction(message, memory.scope);
  if (parsed.changed && chatKeys.length) {
    for (const key of chatKeys) patchBlakeRecordScope(key, parsed.scope);
  }
  if (parsed.rejectedHints.length && chatKeys.length) {
    for (const key of chatKeys) recordBlakeRejectedCodes(key, parsed.rejectedHints);
  }
  const storedHistory = memory.messages.map((item) => ({ role: item.role, text: item.text }));
  const history = (options.history?.length ? options.history : storedHistory).slice(-16);

  if (
    deterministic.action === "report_fault"
    || deterministic.action === "suggest_improvement"
    || looksLikeFaultReport(message)
  ) {
    return handleFaultReportMessage(message, actor, {
      sourceRoute: options.sourceRoute,
      sourcePage: options.sourcePage,
    });
  }

  persistChatTurn(chatKeys, "user", message);

  const finish = (result: NexaAssistantResponse): NexaAssistantResponse => {
    persistChatTurn(chatKeys, "assistant", result.reply);
    return {
      ...result,
      storedMessages: chatKeys[0]
        ? loadBlakeMemoryForScreen({
            takeoffId: options.screenContext?.takeoffId || openRecord.takeoff?.id,
            tenderId: options.screenContext?.tenderId || openRecord.tender?.id,
            jobId: options.screenContext?.jobId || openRecord.job?.id,
          }).messages.map((item) => ({ role: item.role, text: item.text }))
        : undefined,
    };
  };

  if (looksLikeLastScanQuestion(message)) {
    return finish({
      reply: memory.lastScanSummary
        ? `${memory.lastScanSummary}\nYou can type “ignore electrical” or “only pipework and sanitary” and I’ll use that on the next scan. Guide figures only — not a firm tender.`
        : "I have not scanned this drawing in this chat yet. On Takeoff pick the Draw-as layer (Hot & cold / Heating / Waste), then Find CAD plumbing on this sheet.",
      intent: { action: "chat" },
      aiUsed: false,
    });
  }

  if (looksLikeFillRates(message)) {
    return finish(offerBudgetPrices(openRecord, actor, message, now, parsed.scope));
  }

  if (looksLikeOpenRecordQs(message) && (openRecord.tender || openRecord.job || openRecord.takeoff)) {
    const chat = await conversationalReply(
      message,
      history,
      actor.name,
      options.buddyContext,
      openRecord,
      { scope: parsed.scope, lastScanSummary: memory.lastScanSummary },
      coreContext,
    );
    return finish({
      reply: chat.aiUsed ? chat.reply : `${formatOpenRecordBrief(openRecord)}\n\nYou can keep chatting: “ignore electrical”, “we don’t do ventilation”, “price the plumbing bill only”. Confirm before I write guide rates.`,
      intent: { action: "chat" },
      aiUsed: chat.aiUsed,
    });
  }

  const ai = await aiIntent(message, employees, now);
  const intent = ai ?? deterministic;

  if (intent.action === "report_fault" || intent.action === "suggest_improvement") {
    return handleFaultReportMessage(message, actor, {
      sourceRoute: options.sourceRoute,
      sourcePage: options.sourcePage,
    });
  }

  if (deterministic.action === "chat" || (!deterministic.employeeName && deterministic.action !== "book")) {
    if (deterministic.action === "chat" || !looksLikeScheduling(message)) {
      const chat = await conversationalReply(
        message,
        history,
        actor.name,
        options.buddyContext,
        openRecord.tender || openRecord.job || openRecord.takeoff ? openRecord : undefined,
        { scope: parsed.scope, lastScanSummary: memory.lastScanSummary },
        coreContext,
      );
      return finish({
        reply: chat.reply,
        intent: { action: "chat" },
        aiUsed: chat.aiUsed,
      });
    }
  }

  return handleSchedulingMessage(message, actor, now);
}

export async function confirmNexaAssistantAction(actionId: string, actor: { id: string; name: string }) {
  refreshPendingStore();
  const action = pendingStore.actions.find((item) => item.id === actionId);
  if (!action || action.actorId !== actor.id) {
    return { ok: false as const, status: 404, reply: "That request has expired. Ask Blake again." };
  }

  if (action.kind === "budget_prices") {
    const { applyBlakeBudgetPricesToTender } = await import("@/lib/tenders-data");
    try {
      const { tender, priced } = await applyBlakeBudgetPricesToTender(action.tenderId, {
        forceRefresh: action.forceRefresh,
        lineIds: action.lineIds,
      });
      pendingStore.actions = pendingStore.actions.filter((item) => item.id !== action.id);
      persistPendingStore();
      appendAuditEvent({
        actor: actor.name,
        action: "tender.blake_budget_prices",
        recordType: "tender",
        recordId: tender.id,
        summary: action.forceRefresh
          ? `Blake Ask confirmed refresh · ${priced.targetedCount} selected · ${priced.blakeFilled} Blake · ${priced.libraryFilled} library · ${priced.leftBlank} blank · £${priced.budgetTotal}`
          : `Blake Ask confirmed budget prices · ${priced.targetedCount} selected · ${priced.blakeFilled} Blake · ${priced.libraryFilled} library · ${priced.leftBlank} blank · £${priced.budgetTotal}`,
        source: "Blake",
        importance: "high",
      });
      const left = priced.leftBlank
        ? `${priced.leftBlank} line(s) left blank because Blake was not sure — those are not free work.`
        : "No measured lines were left blank this pass.";
      return {
        ok: true as const,
        status: 200,
        reply: [
          `Guide rates written to ${tender.name}.`,
          `FoT / priced BoQ: £${priced.budgetTotal.toFixed(2)} · ${priced.libraryFilled} library · ${priced.blakeFilled} Blake.`,
          left,
          "Amend on Tenders → Bill before you submit. Specialist plant still wants a supplier RFQ.",
        ].join("\n"),
        tenderId: tender.id,
      };
    } catch (error) {
      return {
        ok: false as const,
        status: 409,
        reply: error instanceof Error ? error.message : "Unable to apply Blake budget prices.",
      };
    }
  }

  if (action.kind === "fault_report") {
    const issue = createFaultIssue({
      title: action.title,
      description: action.originalDescription,
      aiDescription: action.description,
      module: action.module,
      type: action.type,
      priority: action.priority,
      reporterId: actor.id,
      reporterName: actor.name,
      sourceRoute: action.sourceRoute,
      sourcePage: action.sourcePage,
      status: "inbox",
    });
    pendingStore.actions = pendingStore.actions.filter((item) => item.id !== action.id);
    persistPendingStore();
    return {
      ok: true as const,
      status: 200,
      reply: [
        `Added as ${issue.reference}`,
        issue.module,
        issue.type === "fault" ? "Fault" : issue.type.replace("_", " "),
        `${issue.priority} priority`,
      ].join("\n"),
      faultReference: issue.reference,
      issueId: issue.id,
    };
  }

  const booking = action as PendingBooking;
  const employee = ((getHubDetailState().employees ?? []) as Employee[]).find((item) => item.id === booking.employeeId);
  const job = getJobs().find((item) => item.id === booking.jobId);
  if (!employee || !job) {
    return { ok: false as const, status: 409, reply: "The employee or job has changed. No booking was created." };
  }
  const currentBookings = scheduleForEmployee(employee, booking.date);
  const clash = currentBookings.find((item) => overlap(booking.startTime, booking.endTime, item.startTime, item.endTime));
  if (clash) {
    return { ok: false as const, status: 409, reply: `The slot is no longer free; it now clashes with ${clash.label}.` };
  }

  const hubState = getHubDetailState();
  const plans = (hubState.jobSchedulePlans ?? {}) as Record<string, ScheduleAssignment[]>;
  const assignment: ScheduleAssignment = {
    id: `${job.id}-assistant-${crypto.randomUUID()}`,
    jobId: job.id,
    costCentreId: booking.costCentreId,
    costCentreName: booking.costCentreName,
    employeeId: employee.id,
    employeeName: employee.name,
    startDate: booking.date,
    startTime: booking.startTime,
    endDate: booking.date,
    endTime: booking.endTime,
    plannedHours: booking.durationHours,
    notes: `Scheduled by Blake for ${actor.name}.`,
  };
  const nextPlans = {
    ...plans,
    [job.id]: [...(plans[job.id] ?? []), assignment].sort((first, second) =>
      `${first.startDate}T${first.startTime}`.localeCompare(`${second.startDate}T${second.startTime}`),
    ),
  };
  saveHubDetailState({ ...hubState, jobSchedulePlans: nextPlans });
  updateJob(job.id, {
    manager: employee.name,
    scheduledDate: booking.date,
    scheduledTime: booking.startTime,
    scheduledDurationHours: booking.durationHours,
    status: ["Pending", "Scheduled"].includes(job.status) ? "In progress" : job.status,
    next: `${employee.name} booked to ${booking.costCentreName} on ${formatUkDate(booking.date)}.`,
  });
  appendAuditEvent({
    actor: actor.name,
    action: "scheduled by Blake",
    recordType: "job",
    recordId: job.id,
    summary: `${employee.name} assigned to ${booking.costCentreName} on ${formatUkDate(booking.date)} from ${booking.startTime} to ${booking.endTime}.`,
    source: "Blake",
    importance: "high",
  });
  pendingStore.actions = pendingStore.actions.filter((item) => item.id !== booking.id);
  persistPendingStore();

  const simpro = await pushJobToSimpro(job.id, {
    actor: actor.name,
    costCentres: ((hubState.jobCostCentres ?? {}) as Record<string, unknown>)[job.id],
    schedule: nextPlans[job.id],
  });
  const simproNote = simpro?.exportRecord.status === "Sent"
    ? " The updated schedule was also sent to simPRO."
    : simpro?.exportRecord.status === "Failed"
      ? " The NeXa booking is saved, but the simPRO update failed and is logged for review."
      : " The NeXa booking is saved; simPRO is not currently configured for a live push.";
  return {
    ok: true as const,
    status: 200,
    reply: `${employee.name} is booked to ${job.ref}, ${booking.costCentreName}, on ${formatUkDate(booking.date)} from ${booking.startTime} to ${booking.endTime}.${simproNote}`,
    assignment,
    jobId: job.id,
  };
}
