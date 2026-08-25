export type ScreenId =
  | "intake"
  | "lead"
  | "quote"
  | "job"
  | "scheduler"
  | "invoice"
  | "audit";

export type PlaybookId =
  | "heating"
  | "bathroom"
  | "radiator"
  | "boiler_service"
  | "water_leak";

export type FieldStatus = "known" | "missing" | "answered";

export type MandatoryField = {
  id: string;
  label: string;
  answer?: string;
  status: FieldStatus;
};

export type Playbook = {
  id: PlaybookId;
  name: string;
  jobType: string;
  /** Lead-stage only — survey detail is collected later on site. */
  fields: MandatoryField[];
};

export type LeadJobTypeOption = {
  id: PlaybookId;
  label: string;
  hint: string;
};

export type AuditActor = "AI" | "Ayla" | "Brian" | "Customer" | "System";

export type AuditEvent = {
  id: string;
  time: string;
  actor: AuditActor;
  action: string;
  detail?: string;
};

export type QuoteSection = {
  id: string;
  title: string;
  items: string[];
};

export type ScheduleSuggestion = {
  engineer: string;
  skills: string[];
  travelMinutes: number;
  slot: string;
  durationDays: number;
  clashes: string[];
};

export type InvoiceGate = {
  id: string;
  label: string;
  ready: boolean;
};

export type HealthAlert = {
  id: string;
  severity: "info" | "amber" | "risk";
  title: string;
  detail: string;
};

/** First intake question — what kind of lead is this? */
export const leadJobTypeOptions: LeadJobTypeOption[] = [
  { id: "boiler_service", label: "Boiler service", hint: "Annual service / Gas Safe check" },
  { id: "water_leak", label: "Water leak", hint: "Burst, drip, or escape of water" },
  { id: "heating", label: "Heating system", hint: "Full renewal / boiler change" },
  { id: "radiator", label: "Radiators", hint: "Replace or add radiators" },
  { id: "bathroom", label: "Bathroom", hint: "Refurb / suite / wet room" },
];

export const EXAMPLE_PROMPT =
  "Mrs Smith from Hillside Avenue wants a complete heating system replacement.";

/** Lead stage only — no survey/site detail here. */
const leadFields: MandatoryField[] = [
  { id: "customer", label: "Customer name", status: "missing" },
  { id: "site_address", label: "Site address", status: "missing" },
  { id: "phone", label: "Phone number", status: "missing" },
  { id: "email", label: "Email", status: "missing" },
];

function leadPlaybook(id: PlaybookId, name: string, jobType: string): Playbook {
  return {
    id,
    name,
    jobType,
    fields: leadFields.map((field) => ({ ...field })),
  };
}

export const playbooks: Record<PlaybookId, Playbook> = {
  boiler_service: leadPlaybook("boiler_service", "Boiler Service Playbook", "Boiler Service"),
  water_leak: leadPlaybook("water_leak", "Water Leak Playbook", "Water Leak"),
  heating: leadPlaybook("heating", "Heating System Playbook", "Heating System Renewal"),
  bathroom: leadPlaybook("bathroom", "Bathroom Playbook", "Bathroom Refurbishment"),
  radiator: leadPlaybook("radiator", "Radiator Playbook", "Radiator Replacement"),
};

export const playbookAnswers: Record<PlaybookId, Record<string, string>> = {
  boiler_service: {
    customer: "Mrs Smith",
    site_address: "14 Hillside Avenue, Harrogate, HG2 7PL",
    phone: "07700 900214",
    email: "mrs.smith@email.com",
  },
  water_leak: {
    customer: "Mr Patel",
    site_address: "8 Oak Road, Leeds, LS8 2QR",
    phone: "07700 900331",
    email: "mr.patel@email.com",
  },
  heating: {
    customer: "Mrs Smith",
    site_address: "14 Hillside Avenue, Harrogate, HG2 7PL",
    phone: "07700 900214",
    email: "mrs.smith@email.com",
  },
  bathroom: {
    customer: "Mr Patel",
    site_address: "8 Oak Road, Leeds, LS8 2QR",
    phone: "07700 900331",
    email: "mr.patel@email.com",
  },
  radiator: {
    customer: "Thompson family",
    site_address: "22 Mill Lane, York, YO10 4AB",
    phone: "07700 900448",
    email: "thompson@email.com",
  },
};

export const conversationSeed = [
  {
    role: "customer" as const,
    text: "Mrs Smith from Hillside Avenue wants a complete heating system replacement.",
  },
  {
    role: "ai" as const,
    text: "Understood — I’m Ayla. I’ve loaded the Heating System Playbook for this lead.",
  },
];

export const quoteSections: QuoteSection[] = [
  {
    id: "scope",
    title: "Scope of Works",
    items: [
      "Strip out and dispose of existing Worcester combi boiler",
      "Supply and install new A-rated combi boiler in utility cupboard",
      "Replace 9 radiators with sized panel radiators and TRVs",
      "Flush system, inhibitor dose, and commission",
      "Gas Safe certification and handover pack",
    ],
  },
  {
    id: "assumptions",
    title: "Assumptions",
    items: [
      "Existing gas supply and flue route remain suitable",
      "No major pipework reroutes beyond radiator drops",
      "Customer provides clear access during 3-day programme",
    ],
  },
  {
    id: "exclusions",
    title: "Exclusions",
    items: [
      "Making good decoration beyond disturbed areas",
      "Electrical consumer unit upgrades",
      "Asbestos removal if discovered",
    ],
  },
  {
    id: "labour",
    title: "Labour",
    items: [
      "Heating engineer × 3 days — £1,440",
      "Mate / second engineer × 2 days — £640",
      "Commissioning & certification — £180",
    ],
  },
  {
    id: "materials",
    title: "Materials",
    items: [
      "Worcester 8000 Style 35kW combi — £1,850",
      "9× radiators + TRVs + fittings — £1,120",
      "Flush chemicals, inhibitor, sundries — £210",
    ],
  },
  {
    id: "cost-centres",
    title: "Cost Centres",
    items: [
      "Boiler plant — £2,180",
      "Radiators & emitters — £1,420",
      "Labour & commissioning — £2,260",
      "Contingency (5%) — £293",
    ],
  },
  {
    id: "risks",
    title: "Risk notes",
    items: [
      "Floor access may reveal extra pipework time",
      "Flue termination to be confirmed on survey photos",
    ],
  },
  {
    id: "programme",
    title: "Suggested programme",
    items: [
      "Day 1 — Strip-out, boiler change, first-fix radiators",
      "Day 2 — Remaining radiators, fill and flush",
      "Day 3 — Commission, certificate, customer handover",
    ],
  },
];

export const commercialSummary = {
  net: 6153,
  vat: 1230.6,
  gross: 7383.6,
  margin: "34%",
};

export const scheduleSuggestion: ScheduleSuggestion = {
  engineer: "James Walsh",
  skills: ["Gas Safe", "Boiler install", "System flush"],
  travelMinutes: 18,
  slot: "Mon 14 Apr · 08:00 start",
  durationDays: 3,
  clashes: [],
};

export const jobTasks = [
  { id: "t1", label: "Pre-site materials check", done: true },
  { id: "t2", label: "Boiler delivery confirmed", done: true },
  { id: "t3", label: "Day 1 installation", done: false },
  { id: "t4", label: "Day 2 radiators & flush", done: false },
  { id: "t5", label: "Commission & certify", done: false },
  { id: "t6", label: "Handover photos", done: false },
];

export const healthAlertsSeed: HealthAlert[] = [
  {
    id: "h1",
    severity: "amber",
    title: "Missing photos",
    detail: "Flue termination photo still outstanding before install day.",
  },
  {
    id: "h2",
    severity: "info",
    title: "Variation opportunity",
    detail: "Customer mentioned cold bathroom — towel rail add-on possible.",
  },
  {
    id: "h3",
    severity: "amber",
    title: "Materials watch",
    detail: "TRV pack on 2-day lead time — confirm stock before Friday.",
  },
];

export function detectPlaybook(prompt: string): PlaybookId {
  const lower = prompt.toLowerCase();
  if (lower.includes("leak") || lower.includes("burst") || lower.includes("flood")) return "water_leak";
  if (
    lower.includes("boiler service") ||
    lower.includes("service the boiler") ||
    (lower.includes("service") && lower.includes("boiler"))
  ) {
    return "boiler_service";
  }
  if (lower.includes("bathroom") || lower.includes("suite")) return "bathroom";
  if (lower.includes("radiator") && !lower.includes("heating system")) return "radiator";
  if (lower.includes("heating") || lower.includes("boiler")) return "heating";
  return "heating";
}

export function extractCustomerName(prompt: string): string {
  const match = prompt.match(/\b(Mrs|Mr|Ms|Miss)\s+([A-Za-z'-]+)/i);
  if (match) return `${match[1]} ${match[2]}`;
  const family = prompt.match(/\b(?:the\s+)?([A-Z][a-z]+)\s+family\b/);
  if (family) return `the ${family[1]} family`;
  return "New customer";
}

export function questionForField(field: MandatoryField, customerName: string): string {
  const who = customerName === "New customer" ? "the customer" : customerName;
  const prompts: Record<string, string> = {
    customer: "Who is the customer?",
    site_address: `What’s the site address for ${who}? Enter the postcode and I’ll offer matching addresses.`,
    phone: "What’s the best phone number to use?",
    email: "Do we have an email address?",
  };
  return prompts[field.id] || `${field.label}?`;
}

/** Prefill anything already stated in the opening message so we never re-ask. */
export function applyKnownFromPrompt(
  fields: MandatoryField[],
  prompt: string,
  _playbookId: PlaybookId,
): MandatoryField[] {
  const name = extractCustomerName(prompt);
  const houseStreet = prompt.match(
    /\b(\d+[A-Za-z]?\s+[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)*)\b/,
  );
  const fromStreet = prompt.match(
    /\bfrom\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)*)\b/,
  );
  const onStreet = prompt.match(
    /\bon\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)*)\b/,
  );
  const postcode = prompt.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);

  return fields.map((field) => {
    if (field.id === "customer" && name !== "New customer") {
      return { ...field, status: "answered", answer: name };
    }
    if (field.id === "site_address") {
      if (houseStreet?.[1]) {
        const line = houseStreet[1];
        const pc = postcode?.[1]?.toUpperCase();
        const address = pc ? `${line}, ${pc}` : line;
        return { ...field, status: "answered", answer: address };
      }
      if (fromStreet || onStreet) {
        const street = (fromStreet || onStreet)?.[1];
        return {
          ...field,
          status: "answered",
          answer: street ? `${street} (confirm house number)` : field.answer,
        };
      }
    }
    return field;
  });
}

export function firstOpenField(fields: MandatoryField[]): MandatoryField | undefined {
  return fields.find((field) => field.status !== "answered");
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export const navScreens: { id: ScreenId; label: string; step: number }[] = [
  { id: "intake", label: "Intake", step: 1 },
  { id: "lead", label: "Lead", step: 2 },
  { id: "quote", label: "Quote", step: 3 },
  { id: "job", label: "Job", step: 4 },
  { id: "scheduler", label: "Schedule", step: 5 },
  { id: "invoice", label: "Invoice", step: 6 },
  { id: "audit", label: "Audit", step: 7 },
];
