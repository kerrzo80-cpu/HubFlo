import type { HubRole } from "@/lib/access";
import type {
  TrainerFlow,
  TrainerMaterial,
  TrainerModule,
  TrainerStoreState,
} from "@/lib/blake-trainer/types";

const now = "2026-08-05T12:00:00.000Z";

const ALL_ROLES: HubRole[] = [
  "Owner/Admin",
  "Manager",
  "Office",
  "Engineer",
  "Finance",
  "Read-only",
];

const FIELD_ROLES: HubRole[] = ["Engineer", "Manager", "Owner/Admin"];
const OFFICE_ROLES: HubRole[] = ["Office", "Manager", "Owner/Admin", "Finance"];

export const blakeTrainerSeedMaterials: TrainerMaterial[] = [
  {
    id: "mat-nexa-what-is",
    title: "What NeXa is",
    kind: "guide",
    content: [
      "NeXa is the command center for service operations.",
      "It binds quotes, jobs, engineers, customers, documents and invoices into one operational view.",
      "Staff should work in NeXa rather than splitting work across spreadsheets, WhatsApp threads and disconnected tools.",
      "Core is the office command center. Field is the engineer phone app. Surveyor and Takeoffs are specialist modules.",
    ].join(" "),
    tags: ["overview", "nexa", "core"],
    roles: ALL_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-company-rule-no-guess",
    title: "Company rule — no guessing",
    kind: "company_rule",
    content: [
      "Blake and all NeXa training answers must only use approved NeXa materials:",
      "guides, screenshots, videos, FAQs and company rules.",
      "If the answer is not in approved materials, say you do not have that in the approved pack and ask the learner to check with their manager or Brian.",
      "Never invent prices, Gas Safe advice outside the pack, customer details, or process steps that are not written down.",
    ].join(" "),
    tags: ["rules", "blake", "safety"],
    roles: ALL_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-field-my-day",
    title: "Field — My Day",
    kind: "guide",
    content: [
      "In NeXa Field, My Day shows the engineer’s scheduled jobs for today.",
      "Open a job to see the job pack: customer, address, cost centre, notes and attachments.",
      "Start and finish work from the job screen so office can see live status.",
      "Use Ask Blake on site for fault help. Use Hours (time check) at the end of the day to confirm actual times.",
    ].join(" "),
    tags: ["field", "my-day", "engineer"],
    roles: FIELD_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-field-hours",
    title: "Field — Hours / Blake time check",
    kind: "guide",
    content: [
      "Hours is Blake’s end-of-day time check.",
      "Blake walks the engineer through each scheduled job and asks them to confirm or amend actual start, end and break minutes.",
      "Gaps in the day must be given a reason: Existing job, Reactive job, Travel, Materials, Admin, Training, Sick/appointment, or Unpaid/no claim.",
      "Submit only when every line is confirmed or amended and gaps are explained.",
      "Submitted hours feed office reporting — do not leave them unfinished.",
    ].join(" "),
    tags: ["field", "hours", "timesheet"],
    roles: FIELD_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-field-ask-blake",
    title: "Field — Ask Blake",
    kind: "faq",
    content: [
      "Ask Blake is the on-site co-pilot for qualified engineers.",
      "Describe a fault or attach site photos. Blake gives likely cause, checks and next steps.",
      "Talk mode uses voice: tap Start talking, speak, then I’m done.",
      "Ask Blake is for trade peer help — it is not a substitute for Gas Safe competence or company method statements.",
      "For gas smell or CO alarm emergencies follow company emergency process and National Gas Emergency 0800 111 999, then notify the office.",
    ].join(" "),
    tags: ["field", "ask-blake", "voice"],
    roles: FIELD_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-core-quotes",
    title: "Core — Quotes overview",
    kind: "guide",
    content: [
      "In NeXa Core, Quotes hold the commercial offer before a job is raised.",
      "Open a quote to review cost centres, labour, materials and sell totals.",
      "Send quotes through the approved quote flow — do not invent discounts outside company pricing rules.",
      "When a quote is accepted, convert it to a job using the Core convert action so scheduling and field can pick it up.",
    ].join(" "),
    tags: ["core", "quotes", "office"],
    roles: OFFICE_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-core-schedule",
    title: "Core — Scheduling",
    kind: "guide",
    content: [
      "Schedules in Core assign engineers to job cost centres with date and time.",
      "Check engineer availability before booking.",
      "Confirm bookings so Field My Day updates.",
      "If using simPRO bridge, confirmed schedule changes may sync outbound — follow the live integration status in Setup.",
    ].join(" "),
    tags: ["core", "schedule", "office"],
    roles: OFFICE_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-screenshot-field-tabs",
    title: "Screenshot — Field tab bar",
    kind: "screenshot",
    content: [
      "Approved Field tab bar (bottom): My Day, Ask Blake, Hours, Connect.",
      "My Day = today’s jobs. Ask Blake = fault help. Hours = time check. Connect = link / settings for Core.",
      "Trainers should point learners to these four tabs only — do not invent extra Field tabs.",
    ].join(" "),
    mediaUrl: "/brand/nexa-command-mark.svg",
    tags: ["field", "screenshot", "ui"],
    roles: FIELD_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-video-hours-walkthrough",
    title: "Video outline — Hours walkthrough",
    kind: "video",
    content: [
      "Approved video outline for Hours:",
      "1) Open Hours from the Field tab bar.",
      "2) Blake lists today’s scheduled jobs.",
      "3) Confirm or amend each job’s actual times.",
      "4) Explain any gaps with an approved reason.",
      "5) Submit the day.",
      "Until a hosted video file is attached, Blake may only teach from this outline — not from external YouTube or unverified clips.",
    ].join(" "),
    tags: ["field", "hours", "video"],
    roles: FIELD_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "mat-faq-who-manages-training",
    title: "FAQ — Who manages training",
    kind: "faq",
    content: [
      "Admins such as Brian (Owner/Admin) create and manage Blake training flows in Train → Admin.",
      "Only approved materials can be used in published flows.",
      "Managers can assign role-aware flows; engineers and office staff complete the flows assigned to their role.",
      "Completion is tracked per person and per flow.",
    ].join(" "),
    tags: ["admin", "training", "faq"],
    roles: ALL_ROLES,
    approved: true,
    approvedBy: "Brian Kerr",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  },
];

export const blakeTrainerSeedModules: TrainerModule[] = [
  {
    id: "mod-nexa-welcome",
    title: "Welcome to NeXa",
    summary: "What NeXa is, and how Blake training works.",
    estimatedMinutes: 8,
    steps: [
      {
        id: "step-welcome-intro",
        kind: "teach",
        title: "Meet Blake",
        script:
          "Hi — I’m Blake, your NeXa trainer. I’ll talk you through each module, pause to check you understand, and answer questions from approved NeXa materials only. If it’s not in the pack, I’ll say so.",
        materialIds: ["mat-nexa-what-is", "mat-company-rule-no-guess"],
      },
      {
        id: "step-welcome-what",
        kind: "teach",
        title: "What NeXa binds together",
        script:
          "NeXa is the command center for service work. Core for office, Field for engineers on the tools, plus Surveyor and Takeoffs when you need them. One place for quotes, jobs, people and invoices.",
        materialIds: ["mat-nexa-what-is"],
      },
      {
        id: "step-welcome-check",
        kind: "check",
        title: "Quick check",
        script:
          "Quick check — in your own words, what is NeXa for, and what should I do if you ask something that isn’t in the approved materials?",
        materialIds: ["mat-nexa-what-is", "mat-company-rule-no-guess"],
        check: {
          id: "chk-welcome",
          prompt:
            "What is NeXa for, and what happens if a question isn’t in the approved materials?",
          expectedPoints: [
            "command center",
            "quotes",
            "jobs",
            "approved",
            "materials",
            "not guess",
            "manager",
            "brian",
          ],
          hintMaterialId: "mat-company-rule-no-guess",
        },
      },
    ],
  },
  {
    id: "mod-field-basics",
    title: "Field basics",
    summary: "My Day, Ask Blake, Hours, and the tab bar.",
    estimatedMinutes: 12,
    steps: [
      {
        id: "step-field-tabs",
        kind: "demo",
        title: "Field tabs",
        script:
          "On Field you’ll see four tabs: My Day, Ask Blake, Hours, and Connect. That’s the whole bottom bar — learn those four first.",
        materialIds: ["mat-screenshot-field-tabs"],
      },
      {
        id: "step-field-myday",
        kind: "teach",
        title: "My Day",
        script:
          "My Day lists today’s jobs. Open a job for the pack — customer, address, notes, attachments — then start and finish work from there so office can see status.",
        materialIds: ["mat-field-my-day"],
      },
      {
        id: "step-field-ask",
        kind: "teach",
        title: "Ask Blake on site",
        script:
          "Ask Blake helps with faults. Type or use Talk: Start talking, say the fault, I’m done. Attach photos if you have them. It doesn’t replace your Gas Safe ticket or method statements.",
        materialIds: ["mat-field-ask-blake"],
      },
      {
        id: "step-field-hours",
        kind: "teach",
        title: "Hours",
        script:
          "At the end of the day open Hours. Confirm or amend each job’s times, explain gaps with an approved reason, then submit. Don’t leave the day unfinished.",
        materialIds: ["mat-field-hours", "mat-video-hours-walkthrough"],
      },
      {
        id: "step-field-check",
        kind: "check",
        title: "Field check",
        script:
          "Check-in — name the four Field tabs, and tell me what you must do in Hours before you finish.",
        materialIds: [
          "mat-screenshot-field-tabs",
          "mat-field-hours",
          "mat-video-hours-walkthrough",
        ],
        check: {
          id: "chk-field",
          prompt: "Name the four Field tabs and what Hours requires before finish.",
          expectedPoints: [
            "my day",
            "ask blake",
            "hours",
            "connect",
            "confirm",
            "gap",
            "submit",
          ],
          hintMaterialId: "mat-screenshot-field-tabs",
        },
      },
    ],
  },
  {
    id: "mod-office-quotes-schedule",
    title: "Office — Quotes and schedule",
    summary: "How office moves work from quote to booked engineer.",
    estimatedMinutes: 10,
    steps: [
      {
        id: "step-office-quotes",
        kind: "teach",
        title: "Quotes",
        script:
          "In Core, Quotes hold the commercial offer. Review cost centres and totals, send through the approved flow, then convert accepted quotes to jobs.",
        materialIds: ["mat-core-quotes"],
      },
      {
        id: "step-office-schedule",
        kind: "teach",
        title: "Scheduling",
        script:
          "Schedules assign engineers to job cost centres. Check availability, confirm the booking so Field updates, and watch simPRO status in Setup if the bridge is live.",
        materialIds: ["mat-core-schedule"],
      },
      {
        id: "step-office-check",
        kind: "check",
        title: "Office check",
        script:
          "Quick check — after a quote is accepted, what do you do next, and what should you check before booking an engineer?",
        materialIds: ["mat-core-quotes", "mat-core-schedule"],
        check: {
          id: "chk-office",
          prompt: "After quote acceptance, next step and what to check before booking.",
          expectedPoints: [
            "convert",
            "job",
            "availability",
            "schedule",
            "confirm",
          ],
          hintMaterialId: "mat-core-quotes",
        },
      },
    ],
  },
];

export const blakeTrainerSeedFlows: TrainerFlow[] = [
  {
    id: "flow-engineer-onboarding",
    title: "Engineer onboarding",
    description: "Voice-first Field training for engineers — NeXa overview plus Field basics.",
    roles: ["Engineer", "Manager", "Owner/Admin"],
    status: "published",
    moduleIds: ["mod-nexa-welcome", "mod-field-basics"],
    createdBy: "Brian Kerr",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "flow-office-onboarding",
    title: "Office onboarding",
    description: "NeXa overview plus quotes and scheduling for office staff.",
    roles: ["Office", "Finance", "Manager", "Owner/Admin"],
    status: "published",
    moduleIds: ["mod-nexa-welcome", "mod-office-quotes-schedule"],
    createdBy: "Brian Kerr",
    createdAt: now,
    updatedAt: now,
  },
];

export function createBlakeTrainerSeedState(): TrainerStoreState {
  return {
    materials: blakeTrainerSeedMaterials.map((item) => ({ ...item })),
    modules: blakeTrainerSeedModules.map((mod) => ({
      ...mod,
      steps: mod.steps.map((step) => ({
        ...step,
        materialIds: [...step.materialIds],
        check: step.check
          ? { ...step.check, expectedPoints: [...step.check.expectedPoints] }
          : undefined,
      })),
    })),
    flows: blakeTrainerSeedFlows.map((flow) => ({
      ...flow,
      roles: [...flow.roles],
      moduleIds: [...flow.moduleIds],
    })),
    progress: [],
  };
}
