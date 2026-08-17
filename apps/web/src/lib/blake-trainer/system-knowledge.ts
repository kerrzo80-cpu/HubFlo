import type { HubRole } from "@/lib/access";
import type {
  TrainerCheckQuestion,
  TrainerFlow,
  TrainerMaterial,
  TrainerMaterialKind,
  TrainerModule,
  TrainerStep,
} from "@/lib/blake-trainer/types";

const STAMP = "2026-08-05T16:00:00.000Z";

export const ALL_ROLES: HubRole[] = [
  "Owner/Admin",
  "Manager",
  "Office",
  "Engineer",
  "Finance",
  "Read-only",
];

export const FIELD_ROLES: HubRole[] = ["Engineer", "Manager", "Owner/Admin"];
export const OFFICE_ROLES: HubRole[] = ["Office", "Manager", "Owner/Admin", "Finance"];
export const COMMERCIAL_ROLES: HubRole[] = ["Office", "Manager", "Owner/Admin", "Finance"];
export const OPS_ROLES: HubRole[] = ["Office", "Manager", "Owner/Admin"];

export type SystemKnowledgeTopic = {
  id: string;
  title: string;
  kind: TrainerMaterialKind;
  area:
    | "overview"
    | "rules"
    | "core"
    | "field"
    | "survey"
    | "takeoff"
    | "heat"
    | "estimator"
    | "trainer"
    | "integrations";
  roles: HubRole[];
  tags: string[];
  content: string;
  mediaUrl?: string;
  /** Short teach script Blake speaks for this topic. */
  teachScript: string;
  /** Understanding-check expected points (lowercase phrases). */
  checkPoints: string[];
  checkPrompt: string;
};

/**
 * Approved NeXa system knowledge Blake may teach from.
 * Keep this pack factual and product-true — no guessing outside it.
 */
export const nexaSystemKnowledge: SystemKnowledgeTopic[] = [
  {
    id: "sys-nexa-overview",
    title: "What NeXa is",
    kind: "guide",
    area: "overview",
    roles: ALL_ROLES,
    tags: ["overview", "nexa", "command-center"],
    content: [
      "NeXa is the command center for service operations.",
      "It binds quotes, jobs, engineers, customers, documents and invoices into one operational view.",
      "Core is the office command center. Field is the engineer phone app.",
      "Surveyor, Takeoffs and Heat Design are specialist modules that feed Core. Estimator is an optional review step after Survey.",
      "Staff should work in NeXa rather than splitting work across spreadsheets, WhatsApp threads and disconnected tools.",
    ].join(" "),
    teachScript:
      "NeXa is your service command center. Core for office, Field for engineers, plus Surveyor, Takeoffs and Heat Design when you need them — one place for quotes, jobs, people and invoices.",
    checkPoints: ["command center", "core", "field", "quotes", "jobs"],
    checkPrompt: "In your own words, what is NeXa and how do Core and Field fit together?",
  },
  {
    id: "sys-rule-no-guess",
    title: "Company rule — no guessing",
    kind: "company_rule",
    area: "rules",
    roles: ALL_ROLES,
    tags: ["rules", "blake", "approved-materials"],
    content: [
      "Blake training answers must only use approved company materials: guides, screenshots, videos, FAQs and company rules.",
      "If it is not in the approved pack, Blake must say so and send the learner to their manager or Brian.",
      "Never invent prices, customer details, Gas Safe advice outside the pack, or process steps that are not written down.",
    ].join(" "),
    teachScript:
      "Important rule: I only teach from approved company materials. If you ask something outside the pack, I will not guess — I’ll tell you to check with your manager or Brian.",
    checkPoints: ["approved", "materials", "not guess", "manager", "brian"],
    checkPrompt: "What should Blake do if a question is not in the approved materials?",
  },
  {
    id: "sys-core-nav",
    title: "Core — main navigation",
    kind: "guide",
    area: "core",
    roles: OFFICE_ROLES,
    tags: ["core", "navigation", "modules"],
    content: [
      "Core’s top module bar covers Dashboard, Leads, Quotes, Jobs, Schedules, Invoices, POs, People, Recurring, Reports, Stock, Xero and Setup.",
      "The blue left sidebar has Overview, My work, Reports, and Addons links to Surveyor, Takeoff, Heat Design, Field and Blake Trainer.",
      "Use Core for office commercial and scheduling work. Use Field for on-site engineer work.",
    ].join(" "),
    teachScript:
      "In Core, the top bar is your main modules — Dashboard through Setup. The blue left rail has Overview and Addons like Field, Surveyor and Blake Trainer.",
    checkPoints: ["dashboard", "quotes", "jobs", "schedules", "setup", "addons"],
    checkPrompt: "Name three Core top-bar modules and one Addon from the blue left rail.",
  },
  {
    id: "sys-core-leads",
    title: "Core — Leads",
    kind: "guide",
    area: "core",
    roles: COMMERCIAL_ROLES,
    tags: ["core", "leads", "pipeline"],
    content: [
      "Leads capture early opportunities before a quote is built.",
      "Open a lead to review customer, site, status and next actions.",
      "AI Intake can help create a lead and book survey when that flow is enabled.",
      "Move work forward by converting or linking into Quotes when the opportunity is ready.",
    ].join(" "),
    teachScript:
      "Leads hold early opportunities. Capture the customer and next action, then move into Quotes when you’re ready to price the work.",
    checkPoints: ["lead", "opportunity", "quote", "customer"],
    checkPrompt: "What are Leads for, and what usually comes next commercially?",
  },
  {
    id: "sys-core-quotes",
    title: "Core — Quotes",
    kind: "guide",
    area: "core",
    roles: COMMERCIAL_ROLES,
    tags: ["core", "quotes", "cost-centres"],
    content: [
      "Quotes hold the commercial offer before a job is raised.",
      "Open a quote to review cost centres, labour, materials and sell totals.",
      "Send quotes through the approved quote flow — do not invent discounts outside company pricing rules.",
      "When a quote is accepted, convert it to a job in Core so scheduling and Field can pick it up.",
    ].join(" "),
    teachScript:
      "Quotes are the commercial offer. Build cost centres and totals, send through the approved flow, then convert accepted quotes to jobs.",
    checkPoints: ["quote", "cost centre", "convert", "job", "sell"],
    checkPrompt: "After a quote is accepted, what do you do next in Core?",
  },
  {
    id: "sys-core-tenders",
    title: "Core — Tenders",
    kind: "guide",
    area: "core",
    roles: COMMERCIAL_ROLES,
    tags: ["core", "tenders", "boq", "blake"],
    content: [
      "Tenders hold client bills of quantities, drawings, qualifications and the Form of Tender.",
      "Open the tender, import their BoQ on the Bill tab, then tick lines and run Blake budget prices (rate library first, UK trade ballpark for gaps).",
      "Ask Blake from the sidebar while the tender (or a job raised from it) is open — he talks through the live BoQ and can fill blank rates after you confirm. That is not a ChatGPT paste-back.",
      "Guide rates stay internal until you amend them and export the FoT. Unsure lines stay blank, never NIL / £0. Won tenders convert to a Core job with cost centres from the BoQ.",
    ].join(" "),
    teachScript:
      "Tenders is the client bill. Import their BoQ, use Blake budget prices as guides, then Ask Blake on the open record to talk through blanks and FoT. Confirm before he writes rates. Won tenders become jobs.",
    checkPoints: ["tender", "boq", "blake", "form of tender", "job"],
    checkPrompt: "How do you budget-price a client BoQ in Tenders, and when does it become a job?",
  },
  {
    id: "sys-core-jobs",
    title: "Core — Jobs",
    kind: "guide",
    area: "core",
    roles: OPS_ROLES,
    tags: ["core", "jobs", "delivery"],
    content: [
      "Jobs are live work records created from accepted quotes or raised directly when needed.",
      "Job records hold cost centres, status, documents, daywork and completion evidence.",
      "Keep job status current so Dashboard, Reports and Field stay aligned.",
      "Do not invoice until completion gates and evidence requirements for that job type are satisfied.",
    ].join(" "),
    teachScript:
      "Jobs are the live work records. Keep status and evidence up to date so Field, office and invoicing all see the same truth.",
    checkPoints: ["job", "status", "cost centre", "evidence", "invoice"],
    checkPrompt: "What should stay current on a Job record, and why?",
  },
  {
    id: "sys-core-schedules",
    title: "Core — Schedules",
    kind: "guide",
    area: "core",
    roles: OPS_ROLES,
    tags: ["core", "schedule", "engineers"],
    content: [
      "Schedules assign engineers to job cost centres with date and time.",
      "Check engineer availability before booking.",
      "Confirm bookings so Field My Day updates for the engineer.",
      "If the simPRO bridge is live, confirmed schedule changes may sync outbound — check Setup integration status.",
    ].join(" "),
    teachScript:
      "Scheduling books engineers onto job cost centres. Check availability, confirm the booking, and Field My Day will show it.",
    checkPoints: ["schedule", "availability", "confirm", "field", "engineer"],
    checkPrompt: "What should you check before booking an engineer, and what does confirming do?",
  },
  {
    id: "sys-core-invoices",
    title: "Core — Invoices",
    kind: "guide",
    area: "core",
    roles: COMMERCIAL_ROLES,
    tags: ["core", "invoices", "finance"],
    content: [
      "Invoices are raised from completed ready work in Core.",
      "Use invoice folders such as sent, unpaid and overdue when reviewing money collection.",
      "Do not force an invoice through when completion gates still block the job.",
      "Finance roles focus on invoice readiness, totals and collection status.",
    ].join(" "),
    teachScript:
      "Invoices come from ready completed work. Check completion gates first, then use the invoice folders to track sent, unpaid and overdue.",
    checkPoints: ["invoice", "completion", "unpaid", "ready"],
    checkPrompt: "When should you raise an invoice, and what folders help track collection?",
  },
  {
    id: "sys-core-people",
    title: "Core — People directory",
    kind: "guide",
    area: "core",
    roles: OPS_ROLES,
    tags: ["core", "people", "employees", "clients"],
    content: [
      "People covers Employees, Clients, Sites, Suppliers, Contacts and Contractors.",
      "Employee cards hold role, access, licences, rates, availability and login.",
      "Clients and sites feed quotes, jobs and Field job packs.",
      "Keep directory records accurate — scheduling and imports depend on them.",
    ].join(" "),
    teachScript:
      "People is the directory — employees, clients, sites, suppliers and contractors. Keep cards accurate because quotes, jobs and Field all read from here.",
    checkPoints: ["employees", "clients", "sites", "role", "directory"],
    checkPrompt: "Name three record types under People and why accuracy matters.",
  },
  {
    id: "sys-core-setup",
    title: "Core — Setup",
    kind: "guide",
    area: "core",
    roles: ["Owner/Admin", "Manager"],
    tags: ["core", "setup", "admin"],
    content: [
      "Setup is for admins and managers: company settings, numbering, forms, integrations, branding and access.",
      "Personalising / branding can set per-app logos including Core, Field and Trainer.",
      "Integration status for simPRO and email lives in Setup — test connections before relying on sync.",
      "Use Save setup when changing shared hub settings so the whole team gets the update.",
    ].join(" "),
    teachScript:
      "Setup is the admin control room — branding, forms, integrations and access. Save setup after changes so the shared workspace updates.",
    checkPoints: ["setup", "branding", "integration", "save", "admin"],
    checkPrompt: "Who uses Setup, and what should you do after changing shared settings?",
  },
  {
    id: "sys-field-tabs",
    title: "Field — tab bar",
    kind: "screenshot",
    area: "field",
    roles: FIELD_ROLES,
    tags: ["field", "tabs", "ui"],
    content: [
      "Approved Field bottom tabs: My Day, Ask Blake, Hours, Connect.",
      "My Day = today’s jobs. Ask Blake = on-site fault help. Hours = end-of-day time check. Connect = link/settings to Core.",
      "Do not invent extra Field tabs beyond this approved bar.",
    ].join(" "),
    mediaUrl: "/brand/nexa-command-mark.svg",
    teachScript:
      "Field has four tabs: My Day, Ask Blake, Hours and Connect. Learn those four first — that’s the whole bottom bar.",
    checkPoints: ["my day", "ask blake", "hours", "connect"],
    checkPrompt: "Name the four Field tabs.",
  },
  {
    id: "sys-field-myday",
    title: "Field — My Day",
    kind: "guide",
    area: "field",
    roles: FIELD_ROLES,
    tags: ["field", "my-day", "jobs"],
    content: [
      "My Day lists the engineer’s scheduled jobs for the selected day.",
      "Open a job for the pack: customer, address, cost centre, notes and attachments.",
      "Start and finish work from the job screen so office can see live status.",
      "Daywork, photos and checklists are completed from the job when required.",
    ].join(" "),
    teachScript:
      "My Day shows today’s jobs. Open the pack, start and finish work from the job screen, and complete daywork or photos when the job needs them.",
    checkPoints: ["my day", "job pack", "start", "finish", "status"],
    checkPrompt: "What do you do in My Day when you arrive on a job?",
  },
  {
    id: "sys-field-ask-blake",
    title: "Field — Ask Blake",
    kind: "faq",
    area: "field",
    roles: FIELD_ROLES,
    tags: ["field", "ask-blake", "voice"],
    content: [
      "Ask Blake is the on-site co-pilot for qualified engineers.",
      "Describe a fault or attach site photos for likely cause, checks and next steps.",
      "Talk mode: tap Start talking, speak, then I’m done.",
      "Ask Blake does not replace Gas Safe competence or company method statements.",
      "For gas smell or CO alarm emergencies follow company emergency process and National Gas Emergency 0800 111 999, then notify the office.",
    ].join(" "),
    teachScript:
      "Ask Blake helps with faults — type or use Talk. Attach photos if you have them. It doesn’t replace your ticket or method statements.",
    checkPoints: ["ask blake", "photos", "talk", "fault", "method"],
    checkPrompt: "How do you use Ask Blake on site, and what does it not replace?",
  },
  {
    id: "sys-field-hours",
    title: "Field — Hours",
    kind: "guide",
    area: "field",
    roles: FIELD_ROLES,
    tags: ["field", "hours", "timesheet"],
    content: [
      "Hours is Blake’s end-of-day time check.",
      "Confirm or amend each job’s actual start, end and break minutes.",
      "Gaps need an approved reason: Existing job, Reactive job, Travel, Materials, Admin, Training, Sick/appointment, or Unpaid/no claim.",
      "Submit only when every line is done and gaps are explained — submitted hours feed office reporting.",
    ].join(" "),
    teachScript:
      "At end of day open Hours. Confirm or amend times, explain gaps with an approved reason, then submit. Don’t leave the day unfinished.",
    checkPoints: ["hours", "confirm", "gap", "submit", "reason"],
    checkPrompt: "What must you finish in Hours before you end the day?",
  },
  {
    id: "sys-surveyor",
    title: "Surveyor module",
    kind: "guide",
    area: "survey",
    roles: Array.from(new Set<HubRole>([...FIELD_ROLES, ...COMMERCIAL_ROLES])),
    tags: ["survey", "evidence", "blake"],
    content: [
      "NeXa Surveyor captures site surveys with photos, drawings, works notes and Blake cost centres.",
      "Survey routes live under /survey and /survey/[id].",
      "Completed surveys hand off to Core via Send to quote. Takeoff or optional Estimate review are available when needed.",
      "Keep photos and scope clear — commercial decisions depend on survey evidence.",
    ].join(" "),
    teachScript:
      "Surveyor is where site surveys are captured — photos, drawings and Blake cost centres that feed Core quotes, with Takeoff when you need drawings.",
    checkPoints: ["survey", "photos", "blake", "quote", "evidence"],
    checkPrompt: "What does Surveyor capture, and what does it feed next?",
  },
  {
    id: "sys-takeoff",
    title: "Takeoffs module",
    kind: "guide",
    area: "takeoff",
    roles: COMMERCIAL_ROLES,
    tags: ["takeoff", "boq", "drawings"],
    content: [
      "NeXa Takeoffs works drawings, markups, BOQs and supplier lists.",
      "Takeoff outputs can feed quote cost centres and materials.",
      "Calibrate drawings and keep layers tidy so quantities stay trustworthy.",
      "Use Takeoff when pricing from plans rather than only from a survey chat.",
    ].join(" "),
    teachScript:
      "Takeoffs turns drawings into markups and BOQ quantities that feed quote cost centres. Keep calibration and layers clean.",
    checkPoints: ["takeoff", "drawing", "boq", "quote", "calibration"],
    checkPrompt: "What does Takeoff produce for the commercial team?",
  },
  {
    id: "sys-heat-design",
    title: "Heat Design module",
    kind: "guide",
    area: "heat",
    roles: COMMERCIAL_ROLES,
    tags: ["heat-design", "emitters", "floor-plan"],
    content: [
      "Heat Design covers floor plans, rooms, emitters and system kit.",
      "Designs can be linked toward quotes or jobs when the kit is ready.",
      "Use Heat Design for heating system layout work, not for general Field timesheets.",
    ].join(" "),
    teachScript:
      "Heat Design is for floor plans, emitters and heating kit — then link the design into a quote or job when ready.",
    checkPoints: ["heat design", "floor plan", "emitters", "quote", "job"],
    checkPrompt: "When would you use Heat Design instead of Field Hours?",
  },
  {
    id: "sys-estimator",
    title: "Estimate review (optional)",
    kind: "guide",
    area: "estimator",
    roles: COMMERCIAL_ROLES,
    tags: ["estimator", "materials", "labour", "optional"],
    content: [
      "Estimate review is optional — the main commercial path is Survey → Send to quote into Core.",
      "Use /estimator when you need to tidy RFQs or material/labour lines before push.",
      "Core Quotes remains the commercial record after push.",
    ].join(" "),
    teachScript:
      "Prefer Survey Send to quote for the main path. Open Estimate review only when RFQs or line tidy-up need a second look before Core.",
    checkPoints: ["survey", "send to quote", "optional", "quote", "review"],
    checkPrompt: "When would you use Estimate review instead of Survey Send to quote?",
  },
  {
    id: "sys-blake-trainer",
    title: "Blake Trainer",
    kind: "faq",
    area: "trainer",
    roles: ALL_ROLES,
    tags: ["trainer", "blake", "admin"],
    content: [
      "Blake Trainer is the voice-first staff training surface at /train.",
      "Training is a continuous conversation: Blake speaks, then listens; you talk naturally and pause when finished; Blake replies — no Start talking button.",
      "Blake pauses for understanding checks, and answers only from approved materials.",
      "Admins such as Brian manage materials and flows in /train/admin.",
      "Blake can rebuild role-aware modules from the approved NeXa system knowledge pack — still no guessing outside that pack.",
      "Completion is tracked per person and per flow.",
    ].join(" "),
    teachScript:
      "You’re in Blake Trainer. We talk back and forth — I’ll teach, then listen while you speak, then reply. Checks stay grounded in the approved NeXa pack. Admins rebuild modules when the system changes.",
    checkPoints: ["train", "approved", "check", "admin", "completion"],
    checkPrompt: "What does Blake Trainer do, and what must answers stay grounded in?",
  },
  {
    id: "sys-simpro",
    title: "simPRO integration (approved facts)",
    kind: "faq",
    area: "integrations",
    roles: ["Owner/Admin", "Manager", "Office"],
    tags: ["simpro", "integration", "sync"],
    content: [
      "NeXa can connect to simPRO for imports and selected outbound pushes.",
      "Check Setup integration status before relying on sync.",
      "Imports may cover clients, sites, leads, quotes, jobs, schedules and invoices depending on configured scope.",
      "If sync looks wrong, do not invent a fix — check Setup status and escalate to Brian or the integration owner.",
    ].join(" "),
    teachScript:
      "simPRO can sync selected records with NeXa. Always check Setup integration status first — if something looks off, escalate rather than guessing.",
    checkPoints: ["simpro", "setup", "sync", "import", "status"],
    checkPrompt: "Where do you check simPRO connection health, and what if sync looks wrong?",
  },
];

export function knowledgeToMaterials(approvedBy = "Brian Kerr"): TrainerMaterial[] {
  return nexaSystemKnowledge.map((topic) => ({
    id: `mat-${topic.id}`,
    title: topic.title,
    kind: topic.kind,
    content: topic.content,
    mediaUrl: topic.mediaUrl,
    tags: topic.tags,
    roles: [...topic.roles],
    approved: true,
    approvedBy,
    approvedAt: STAMP,
    createdAt: STAMP,
    updatedAt: STAMP,
  }));
}

function teachStep(topic: SystemKnowledgeTopic): TrainerStep {
  return {
    id: `step-${topic.id}-teach`,
    kind: topic.kind === "screenshot" || topic.kind === "video" ? "demo" : "teach",
    title: topic.title,
    script: topic.teachScript,
    materialIds: [`mat-${topic.id}`],
  };
}

function checkStep(topic: SystemKnowledgeTopic): TrainerStep {
  const check: TrainerCheckQuestion = {
    id: `chk-${topic.id}`,
    prompt: topic.checkPrompt,
    expectedPoints: [...topic.checkPoints],
    hintMaterialId: `mat-${topic.id}`,
  };
  return {
    id: `step-${topic.id}-check`,
    kind: "check",
    title: `Check — ${topic.title}`,
    script: `Quick check. ${topic.checkPrompt}`,
    materialIds: [`mat-${topic.id}`, "mat-sys-rule-no-guess"],
    check,
  };
}

export type GeneratedCatalog = {
  materials: TrainerMaterial[];
  modules: TrainerModule[];
  flows: TrainerFlow[];
};

function moduleFromTopics(
  id: string,
  title: string,
  summary: string,
  topicIds: string[],
  minutes: number,
): TrainerModule {
  const topics = topicIds
    .map((topicId) => nexaSystemKnowledge.find((topic) => topic.id === topicId))
    .filter((topic): topic is SystemKnowledgeTopic => Boolean(topic));
  const steps: TrainerStep[] = [];
  topics.forEach((topic, index) => {
    steps.push(teachStep(topic));
    // Check every topic, and always include a closing check on the last item.
    if (index === topics.length - 1 || topic.area === "rules" || topic.checkPoints.length >= 4) {
      steps.push(checkStep(topic));
    }
  });
  return {
    id,
    title,
    summary,
    estimatedMinutes: minutes,
    steps,
  };
}

export function generateBlakeTrainerCatalog(options?: {
  approvedBy?: string;
  createdBy?: string;
}): GeneratedCatalog {
  const approvedBy = options?.approvedBy ?? "Brian Kerr";
  const createdBy = options?.createdBy ?? approvedBy;
  const materials = knowledgeToMaterials(approvedBy);

  const modules: TrainerModule[] = [
    moduleFromTopics(
      "mod-nexa-foundations",
      "NeXa foundations",
      "What NeXa is, the no-guessing rule, and how Blake Trainer works.",
      ["sys-nexa-overview", "sys-rule-no-guess", "sys-blake-trainer"],
      10,
    ),
    moduleFromTopics(
      "mod-core-commercial",
      "Core commercial path",
      "Leads → Quotes → Jobs → Invoices in Core.",
      ["sys-core-nav", "sys-core-leads", "sys-core-quotes", "sys-core-tenders", "sys-core-jobs", "sys-core-invoices"],
      18,
    ),
    moduleFromTopics(
      "mod-core-operations",
      "Core operations",
      "Scheduling, People directory and Setup for office ops.",
      ["sys-core-schedules", "sys-core-people", "sys-core-setup", "sys-simpro"],
      14,
    ),
    moduleFromTopics(
      "mod-field-complete",
      "Field complete",
      "My Day, Ask Blake, Hours and the Field tab bar.",
      ["sys-field-tabs", "sys-field-myday", "sys-field-ask-blake", "sys-field-hours"],
      16,
    ),
    moduleFromTopics(
      "mod-specialist-tools",
      "Specialist tools",
      "Surveyor, Takeoffs, Heat Design and Estimator.",
      ["sys-surveyor", "sys-takeoff", "sys-heat-design", "sys-estimator"],
      14,
    ),
  ];

  const flows: TrainerFlow[] = [
    {
      id: "flow-everyone-foundations",
      title: "Everyone — NeXa foundations",
      description: "Blake teaches what NeXa is, the no-guess rule, and how training works.",
      roles: ALL_ROLES,
      status: "published",
      moduleIds: ["mod-nexa-foundations"],
      createdBy,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: "flow-engineer-full",
      title: "Engineer — Field mastery",
      description: "Foundations plus complete Field training generated from system knowledge.",
      roles: FIELD_ROLES,
      status: "published",
      moduleIds: ["mod-nexa-foundations", "mod-field-complete"],
      createdBy,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: "flow-office-full",
      title: "Office — Core commercial & ops",
      description: "Foundations plus Core commercial path, operations and specialist tools.",
      roles: OFFICE_ROLES,
      status: "published",
      moduleIds: [
        "mod-nexa-foundations",
        "mod-core-commercial",
        "mod-core-operations",
        "mod-specialist-tools",
      ],
      createdBy,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: "flow-manager-full",
      title: "Manager — full system map",
      description: "All Blake-generated modules across Core, Field and specialist tools.",
      roles: ["Manager", "Owner/Admin"],
      status: "published",
      moduleIds: modules.map((mod) => mod.id),
      createdBy,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ];

  return { materials, modules, flows };
}
