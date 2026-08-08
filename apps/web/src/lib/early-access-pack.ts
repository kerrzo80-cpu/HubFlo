/**
 * Commercial pack for NeXa Company Production — Early Access.
 * Single-company offer. Not multi-tenant SaaS.
 */
export const EARLY_ACCESS_PACK = {
  productName: "NeXa",
  offerName: "Company Production — Early Access",
  buyer: "Errol Watson Group (named company)",
  posture: "single-company production",
  packageLine:
    "All-in-one ops package: Core, Survey, Takeoff, Heat Design and Field on one live record.",
  /** Replace when commercial terms are signed. */
  pricingLabel: "Agreed monthly company fee",
  pricingNote:
    "Flat company fee for the full NeXa package — Core, Survey, Heat Design, Takeoff and Field — not per-seat SaaS pricing.",
  supportOwner: "Brian Kerr",
  supportEmail: "brian.kerr@errolwatsongroup.com",
  supportWindow: "Business hours, same working day for blocking issues",
  mailtoSubject: "NeXa Early Access — accept company production",
  included: [
    "Full package: Core, Survey, Takeoff, Heat Design and Field",
    "Live ops spine: lead → survey / heat / takeoff → quote → job → invoice",
    "Core office command centre + Field engineer app",
    "Blake AI (OpenAI-backed) across Survey, Heat Design and Takeoff",
    "Price Ledger: Budget / Guide / RFQ / Firm",
    "Company backup export, restore dry-run and shadow restore fire-drill",
    "Setup ops checklist and services monitor",
  ],
  excluded: [
    "Multi-company / multi-tenant SaaS hosting",
    "Public marketplace or white-label reseller programme",
    "simPRO as permanent system of record (optional bridge only)",
    "Guaranteed two-way simPRO reconciliation",
  ],
  startSteps: [
    {
      title: "Accept the pack",
      detail: "Confirm early access by email. Scope, support and exit terms stay on this page.",
    },
    {
      title: "Check readiness",
      detail: "Open Setup → Ops checklist. Workspace, auth, OpenAI and backup should read green.",
    },
    {
      title: "Run live work",
      detail: "Use Core for the daily path: lead → quote → job → invoice. Plumbing sales stay in Core.",
    },
  ],
  simproStance:
    "simPRO stays as an optional bridge until NeXa is clearly the system of record. It is not a go-live blocker.",
  exitTerms:
    "You can export a full company backup at any time from Setup → Ops checklist. Auth passwords are never included in the backup file.",
  acceptanceProof: [
    "20 end-to-end test jobs run on live (survey / heat / direct → quote → job → invoice)",
    "Leads, quotes, jobs and invoices persist in the live company store",
    "Company production readiness green: workspace, auth, OpenAI, backup, restore fire-drill",
  ],
} as const;
