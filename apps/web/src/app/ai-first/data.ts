export type ScreenId =
  | "intake"
  | "lead"
  | "quote"
  | "job"
  | "scheduler"
  | "invoice"
  | "audit";

export type PlaybookId = "heating" | "bathroom" | "radiator";

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
  fields: MandatoryField[];
};

export type AuditActor = "AI" | "Brian" | "Customer" | "System";

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

export const EXAMPLE_PROMPT =
  "Mrs Smith from Hillside Avenue wants a complete heating system replacement.";

export const playbooks: Record<PlaybookId, Playbook> = {
  heating: {
    id: "heating",
    name: "Heating System Playbook",
    jobType: "Heating System Renewal",
    fields: [
      { id: "address", label: "Full address", status: "missing" },
      { id: "postcode", label: "Postcode", status: "missing" },
      { id: "phone", label: "Phone number", status: "missing" },
      { id: "email", label: "Email", status: "missing" },
      { id: "property", label: "Property type", status: "missing" },
      { id: "bedrooms", label: "Number of bedrooms", status: "missing" },
      { id: "boiler", label: "Existing boiler", status: "missing" },
      { id: "cylinder", label: "Existing cylinder?", status: "missing" },
      { id: "radiators", label: "Number of radiators", status: "missing" },
      { id: "gas", label: "Gas available?", status: "missing" },
      { id: "pipework", label: "Pipework accessible?", status: "missing" },
      { id: "floors", label: "Floors timber/concrete?", status: "missing" },
      { id: "location", label: "Desired boiler location", status: "missing" },
      { id: "occupied", label: "Property occupied?", status: "missing" },
      { id: "timescale", label: "Timescale", status: "missing" },
      { id: "photos", label: "Photos", status: "missing" },
    ],
  },
  bathroom: {
    id: "bathroom",
    name: "Bathroom Playbook",
    jobType: "Bathroom Refurbishment",
    fields: [
      { id: "address", label: "Full address", status: "missing" },
      { id: "postcode", label: "Postcode", status: "missing" },
      { id: "phone", label: "Phone number", status: "missing" },
      { id: "suite", label: "Suite preference", status: "missing" },
      { id: "tiling", label: "Tiling extent", status: "missing" },
      { id: "extract", label: "Extraction required?", status: "missing" },
      { id: "wetroom", label: "Wet room conversion?", status: "missing" },
      { id: "access", label: "Access constraints", status: "missing" },
      { id: "timescale", label: "Timescale", status: "missing" },
      { id: "photos", label: "Photos", status: "missing" },
    ],
  },
  radiator: {
    id: "radiator",
    name: "Radiator Playbook",
    jobType: "Radiator Replacement",
    fields: [
      { id: "address", label: "Full address", status: "missing" },
      { id: "postcode", label: "Postcode", status: "missing" },
      { id: "phone", label: "Phone number", status: "missing" },
      { id: "count", label: "Number of radiators", status: "missing" },
      { id: "sizes", label: "Radiator sizes", status: "missing" },
      { id: "valves", label: "TRV upgrade?", status: "missing" },
      { id: "system", label: "System type", status: "missing" },
      { id: "timescale", label: "Timescale", status: "missing" },
      { id: "photos", label: "Photos", status: "missing" },
    ],
  },
};

export const playbookAnswers: Record<PlaybookId, Record<string, string>> = {
  heating: {
    address: "14 Hillside Avenue, Harrogate",
    postcode: "HG2 7PL",
    phone: "07700 900214",
    email: "mrs.smith@email.com",
    property: "Semi-detached house",
    bedrooms: "3 bedrooms",
    boiler: "15-year Worcester combi",
    cylinder: "No — combi system",
    radiators: "9 radiators",
    gas: "Yes — meter in kitchen",
    pipework: "Mostly accessible under floors",
    floors: "Ground timber, first floor timber",
    location: "Utility cupboard (current)",
    occupied: "Yes — family in residence",
    timescale: "Within 6 weeks",
    photos: "4 site photos attached",
  },
  bathroom: {
    address: "8 Oak Road, Leeds",
    postcode: "LS8 2QR",
    phone: "07700 900331",
    suite: "Modern white suite with walk-in shower",
    tiling: "Full height wet walls + floor",
    extract: "Yes — humidistat fan",
    wetroom: "Partial wet zone",
    access: "First floor · stair carry",
    timescale: "Next month",
    photos: "3 bathroom photos attached",
  },
  radiator: {
    address: "22 Mill Lane, York",
    postcode: "YO10 4AB",
    phone: "07700 900448",
    count: "3 radiators",
    sizes: "600×1000, 600×800, 600×600",
    valves: "Yes — TRV upgrade",
    system: "Sealed system",
    timescale: "This fortnight",
    photos: "2 radiator photos attached",
  },
};

export const conversationSeed = [
  {
    role: "customer" as const,
    text: "Mrs Smith from Hillside Avenue wants a complete heating system replacement.",
  },
  {
    role: "ai" as const,
    text: "Understood. I’ve created a draft lead and loaded the Heating System Playbook. I need a few mandatory details before I can build a quote.",
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
  if (lower.includes("bathroom") || lower.includes("suite")) return "bathroom";
  if (lower.includes("radiator") && !lower.includes("heating system") && !lower.includes("boiler")) {
    return "radiator";
  }
  return "heating";
}

export function extractCustomerName(prompt: string): string {
  const match = prompt.match(/\b(Mrs|Mr|Ms|Miss)\s+([A-Za-z'-]+)/i);
  if (match) return `${match[1]} ${match[2]}`;
  return "New customer";
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
