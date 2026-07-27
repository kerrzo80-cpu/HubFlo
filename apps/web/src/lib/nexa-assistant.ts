import { appendAuditEvent } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { getLeads } from "@/lib/lead-store";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import { pushJobToSimpro } from "@/lib/simpro-bridge";
import { getJobs, updateJob, type Job } from "@/lib/workflow-data";
import type { Employee, Weekday } from "@/lib/access";

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
  action: "availability" | "book" | "help";
  employeeName?: string;
  dateText?: string;
  dateIso?: string;
  weekday?: string;
  jobRef?: string;
  costCentreName?: string;
  startTime?: string;
  durationHours?: number;
};

type PendingBooking = {
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

type PendingStore = { actions: PendingBooking[] };

export type NexaAssistantResponse = {
  reply: string;
  intent: AssistantIntent;
  action?: {
    id: string;
    kind: "confirm_booking";
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
  };
  aiUsed: boolean;
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

function deterministicIntent(message: string, employees: Employee[], now = new Date()): AssistantIntent {
  const date = parseDate(message, now);
  const lower = message.toLowerCase();
  return {
    action: /\b(book|schedule|assign|put)\b/i.test(message) ? "book" : /\b(available|availability|free|diary)\b/i.test(message) ? "availability" : "help",
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
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim()
    || process.env.NEXA_TAKEOFF_OPENAI_MODEL?.trim()
    || "gpt-5.6-sol";
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
              text: `Extract a NeXa scheduling intent. Today is ${now.toISOString().slice(0, 10)}. UK date order is day/month/year. Employees: ${employees.map((employee) => employee.name).join(", ")}. Never silently repair a weekday/date mismatch.`,
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
                action: { type: "string", enum: ["availability", "book", "help"] },
                employeeName: { type: ["string", "null"] },
                dateText: { type: ["string", "null"] },
                dateIso: { type: ["string", "null"] },
                weekday: { type: ["string", "null"] },
                jobRef: { type: ["string", "null"] },
                costCentreName: { type: ["string", "null"] },
                startTime: { type: ["string", "null"] },
                durationHours: { type: ["number", "null"] },
              },
              required: ["action", "employeeName", "dateText", "dateIso", "weekday", "jobRef", "costCentreName", "startTime", "durationHours"],
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

export async function handleNexaAssistantMessage(
  message: string,
  actor: { id: string; name: string },
  now = new Date(),
): Promise<NexaAssistantResponse> {
  const hubState = getHubDetailState();
  const employees = (hubState.employees ?? []) as Employee[];
  const deterministic = deterministicIntent(message, employees, now);
  const extracted = await aiIntent(message, employees, now);
  const intent: AssistantIntent = {
    ...deterministic,
    ...Object.fromEntries(Object.entries(extracted ?? {}).filter(([, value]) => value !== undefined)),
  };

  // Record identities and calendar facts come from the user's literal text so the
  // model cannot invent an employee, job or silently repaired date.
  intent.employeeName = deterministic.employeeName;
  intent.jobRef = deterministic.jobRef;
  const localDate = parseDate(message, now);
  if (localDate.dateIso) intent.dateIso = localDate.dateIso;
  if (localDate.namedWeekday) intent.weekday = localDate.namedWeekday;
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

export async function confirmNexaAssistantAction(actionId: string, actor: { id: string; name: string }) {
  refreshPendingStore();
  const action = pendingStore.actions.find((item) => item.id === actionId);
  if (!action || action.actorId !== actor.id) {
    return { ok: false as const, status: 404, reply: "That booking request has expired. Ask NeXa to check the slot again." };
  }
  const employee = ((getHubDetailState().employees ?? []) as Employee[]).find((item) => item.id === action.employeeId);
  const job = getJobs().find((item) => item.id === action.jobId);
  if (!employee || !job) {
    return { ok: false as const, status: 409, reply: "The employee or job has changed. No booking was created." };
  }
  const currentBookings = scheduleForEmployee(employee, action.date);
  const clash = currentBookings.find((booking) => overlap(action.startTime, action.endTime, booking.startTime, booking.endTime));
  if (clash) {
    return { ok: false as const, status: 409, reply: `The slot is no longer free; it now clashes with ${clash.label}.` };
  }

  const hubState = getHubDetailState();
  const plans = (hubState.jobSchedulePlans ?? {}) as Record<string, ScheduleAssignment[]>;
  const assignment: ScheduleAssignment = {
    id: `${job.id}-assistant-${crypto.randomUUID()}`,
    jobId: job.id,
    costCentreId: action.costCentreId,
    costCentreName: action.costCentreName,
    employeeId: employee.id,
    employeeName: employee.name,
    startDate: action.date,
    startTime: action.startTime,
    endDate: action.date,
    endTime: action.endTime,
    plannedHours: action.durationHours,
    notes: `Scheduled by NeXa Assistant for ${actor.name}.`,
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
    scheduledDate: action.date,
    scheduledTime: action.startTime,
    scheduledDurationHours: action.durationHours,
    status: ["Pending", "Scheduled"].includes(job.status) ? "In progress" : job.status,
    next: `${employee.name} booked to ${action.costCentreName} on ${formatUkDate(action.date)}.`,
  });
  appendAuditEvent({
    actor: actor.name,
    action: "scheduled by NeXa Assistant",
    recordType: "job",
    recordId: job.id,
    summary: `${employee.name} assigned to ${action.costCentreName} on ${formatUkDate(action.date)} from ${action.startTime} to ${action.endTime}.`,
    source: "NeXa Assistant",
    importance: "high",
  });
  pendingStore.actions = pendingStore.actions.filter((item) => item.id !== action.id);
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
    reply: `${employee.name} is booked to ${job.ref}, ${action.costCentreName}, on ${formatUkDate(action.date)} from ${action.startTime} to ${action.endTime}.${simproNote}`,
    assignment,
    jobId: job.id,
  };
}
