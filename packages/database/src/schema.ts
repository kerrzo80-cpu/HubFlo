import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").defaultRandom().primaryKey();
const tenantId = () => uuid("tenant_id").notNull();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "active",
  "suspended",
]);
export const jobHealth = pgEnum("job_health", ["green", "amber", "red"]);
export const taskStatus = pgEnum("task_status", [
  "open",
  "in_progress",
  "waiting",
  "complete",
  "cancelled",
]);
export const variationStatus = pgEnum("variation_status", [
  "detected",
  "needs_review",
  "priced",
  "sent_to_client",
  "approved",
  "rejected",
  "added_to_job_value",
  "ready_to_invoice",
]);
export const quoteStatus = pgEnum("quote_status", [
  "draft",
  "sent",
  "accepted",
  "declined",
  "converted",
  "lost",
]);
export const alertStatus = pgEnum("alert_status", [
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
]);

export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    legalName: text("legal_name"),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("tenants_slug_unique").on(table.slug)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    permissions: jsonb("permissions").$type<string[]>().default([]).notNull(),
    isSystemDefault: boolean("is_system_default").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("roles_tenant_key_unique").on(table.tenantId, table.key),
    index("roles_tenant_idx").on(table.tenantId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    status: membershipStatus("status").default("invited").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("memberships_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
    index("memberships_tenant_idx").on(table.tenantId),
  ],
);

export const companySettings = pgTable(
  "company_settings",
  {
    id: id(),
    tenantId: tenantId(),
    timezone: text("timezone").default("Europe/London").notNull(),
    currency: text("currency").default("GBP").notNull(),
    branding: jsonb("branding").$type<Record<string, unknown>>().default({}).notNull(),
    operationalRules: jsonb("operational_rules")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("company_settings_tenant_unique").on(table.tenantId),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    accountReference: text("account_reference"),
    email: text("email"),
    phone: text("phone"),
    billingAddress: jsonb("billing_address").$type<Record<string, string>>(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    index("customers_tenant_idx").on(table.tenantId),
    uniqueIndex("customers_tenant_reference_unique").on(
      table.tenantId,
      table.accountReference,
    ),
  ],
);

export const sites = pgTable(
  "sites",
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid("customer_id").notNull(),
    name: text("name").notNull(),
    address: jsonb("address").$type<Record<string, string>>().notNull(),
    accessNotes: text("access_notes"),
    ...timestamps,
  },
  (table) => [
    index("sites_tenant_idx").on(table.tenantId),
    index("sites_tenant_customer_idx").on(table.tenantId, table.customerId),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    tenantId: tenantId(),
    reference: text("reference").notNull(),
    customerId: uuid("customer_id").notNull(),
    siteId: uuid("site_id"),
    title: text("title").notNull(),
    description: text("description"),
    ownerUserId: uuid("owner_user_id"),
    status: quoteStatus("status").default("draft").notNull(),
    value: numeric("value", { precision: 14, scale: 2 }).default("0").notNull(),
    convertedJobId: uuid("converted_job_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("quotes_tenant_reference_unique").on(
      table.tenantId,
      table.reference,
    ),
    index("quotes_tenant_customer_idx").on(table.tenantId, table.customerId),
    index("quotes_tenant_site_idx").on(table.tenantId, table.siteId),
    index("quotes_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const jobStatuses = pgTable(
  "job_statuses",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    semanticCategory: text("semantic_category").notNull(),
    healthEffect: jobHealth("health_effect"),
    sortOrder: integer("sort_order").default(0).notNull(),
    terminal: boolean("terminal").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("job_statuses_tenant_key_unique").on(table.tenantId, table.key),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    tenantId: tenantId(),
    reference: text("reference").notNull(),
    customerId: uuid("customer_id").notNull(),
    siteId: uuid("site_id").notNull(),
    sourceQuoteId: uuid("source_quote_id"),
    statusId: uuid("status_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    health: jobHealth("health").default("green").notNull(),
    originalQuoteValue: numeric("original_quote_value", {
      precision: 14,
      scale: 2,
    }).default("0").notNull(),
    revisedJobValue: numeric("revised_job_value", {
      precision: 14,
      scale: 2,
    }).default("0").notNull(),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("jobs_tenant_reference_unique").on(
      table.tenantId,
      table.reference,
    ),
    index("jobs_tenant_customer_idx").on(table.tenantId, table.customerId),
    index("jobs_tenant_site_idx").on(table.tenantId, table.siteId),
    index("jobs_tenant_source_quote_idx").on(table.tenantId, table.sourceQuoteId),
    index("jobs_tenant_health_idx").on(table.tenantId, table.health),
  ],
);

export const jobVisits = pgTable(
  "job_visits",
  {
    id: id(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    assignedUserId: uuid("assigned_user_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").default("scheduled").notNull(),
    engineerNotes: text("engineer_notes"),
    ...timestamps,
  },
  (table) => [
    index("job_visits_tenant_job_idx").on(table.tenantId, table.jobId),
    index("job_visits_tenant_user_idx").on(
      table.tenantId,
      table.assignedUserId,
    ),
  ],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: id(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    actorUserId: uuid("actor_user_id"),
    source: text("source").default("system").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("timeline_events_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
      table.occurredAt,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    description: text("description"),
    ownerUserId: uuid("owner_user_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: taskStatus("status").default("open").notNull(),
    priority: text("priority").default("normal").notNull(),
    linkedRecordType: text("linked_record_type").notNull(),
    linkedRecordId: uuid("linked_record_id").notNull(),
    createdSource: text("created_source").default("manual").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("tasks_tenant_owner_idx").on(table.tenantId, table.ownerUserId),
    index("tasks_tenant_linked_record_idx").on(
      table.tenantId,
      table.linkedRecordType,
      table.linkedRecordId,
    ),
  ],
);

export const blockers = pgTable(
  "blockers",
  {
    id: id(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    severity: jobHealth("severity").default("amber").notNull(),
    ownerUserId: uuid("owner_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    ...timestamps,
  },
  (table) => [
    index("blockers_tenant_job_idx").on(table.tenantId, table.jobId),
  ],
);

export const variations = pgTable(
  "variations",
  {
    id: id(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: variationStatus("status").default("detected").notNull(),
    costValue: numeric("cost_value", { precision: 14, scale: 2 }),
    sellValue: numeric("sell_value", { precision: 14, scale: 2 }),
    detectedSource: text("detected_source").default("manual").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("variations_tenant_reference_unique").on(
      table.tenantId,
      table.reference,
    ),
    index("variations_tenant_job_idx").on(table.tenantId, table.jobId),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    detail: text("detail"),
    linkedRecordType: text("linked_record_type").notNull(),
    linkedRecordId: uuid("linked_record_id").notNull(),
    priority: text("priority").default("normal").notNull(),
    ownerUserId: uuid("owner_user_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: alertStatus("status").default("open").notNull(),
    createdSource: text("created_source").default("system").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("alerts_tenant_status_idx").on(table.tenantId, table.status),
    index("alerts_tenant_linked_record_idx").on(
      table.tenantId,
      table.linkedRecordType,
      table.linkedRecordId,
    ),
  ],
);

export const processTemplates = pgTable(
  "process_templates",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    version: integer("version").default(1).notNull(),
    published: boolean("published").default(false).notNull(),
    jobType: text("job_type").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("process_templates_tenant_key_version_unique").on(
      table.tenantId,
      table.key,
      table.version,
    ),
  ],
);

export const jobWorkflowInstances = pgTable(
  "job_workflow_instances",
  {
    id: id(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    visitId: uuid("visit_id"),
    processTemplateId: uuid("process_template_id").notNull(),
    currentStageKey: text("current_stage_key"),
    status: text("status").default("not_started").notNull(),
    submission: jsonb("submission").$type<Record<string, unknown>>().default({}).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("workflow_instances_tenant_job_idx").on(table.tenantId, table.jobId),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid("customer_id"),
    siteId: uuid("site_id"),
    type: text("type").notNull(),
    name: text("name").notNull(),
    make: text("make"),
    model: text("model"),
    serialNumber: text("serial_number"),
    status: text("status").default("active").notNull(),
    lastServiceDate: date("last_service_date"),
    nextServiceDate: date("next_service_date"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    index("assets_tenant_site_idx").on(table.tenantId, table.siteId),
    index("assets_tenant_next_service_idx").on(
      table.tenantId,
      table.nextServiceDate,
    ),
  ],
);

export const servicePlans = pgTable(
  "service_plans",
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid("customer_id").notNull(),
    siteId: uuid("site_id").notNull(),
    assetId: uuid("asset_id"),
    type: text("type").notNull(),
    status: text("status").default("active").notNull(),
    startDate: date("start_date").notNull(),
    renewalDate: date("renewal_date"),
    nextServiceDueDate: date("next_service_due_date"),
    price: numeric("price", { precision: 14, scale: 2 }),
    billingFrequency: text("billing_frequency"),
    autoRenew: boolean("auto_renew").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    index("service_plans_tenant_due_idx").on(
      table.tenantId,
      table.nextServiceDueDate,
    ),
  ],
);

export const timesheetEntries = pgTable(
  "timesheet_entries",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id").notNull(),
    visitId: uuid("visit_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    breakMinutes: integer("break_minutes").default(0).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    index("timesheets_tenant_job_idx").on(table.tenantId, table.jobId),
    index("timesheets_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: tenantId(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_tenant_record_idx").on(
      table.tenantId,
      table.recordType,
      table.recordId,
    ),
  ],
);
