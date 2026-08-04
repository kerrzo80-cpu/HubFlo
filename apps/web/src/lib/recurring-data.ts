import { getClients, getClientSites } from "@/lib/people-data";
import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { listSiteAssets } from "@/lib/site-assets-data";

export type RecurringKind = "Job" | "Invoice";
export type RecurringFrequency = "Weekly" | "Monthly" | "Quarterly" | "Yearly";

export type RecurringPlan = {
  id: string;
  kind: RecurringKind;
  name: string;
  customer: string;
  clientId?: string;
  siteId?: string;
  site?: string;
  description: string;
  frequency: RecurringFrequency;
  nextDueDate: string;
  amount?: number;
  active: boolean;
  linkedJobTemplate?: string;
  notes?: string;
  lastGeneratedAt?: string;
  lastGeneratedRef?: string;
  createdAt: string;
};

type RecurringStore = {
  plans: RecurringPlan[];
};

const STORE = "nexa-recurring-v1";

function readStore(): RecurringStore {
  return loadServerStore<RecurringStore>(STORE, { plans: [] });
}

function writeStore(store: RecurringStore) {
  writeServerStore(STORE, store);
  return store;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function shiftDueDate(isoDate: string, frequency: RecurringFrequency) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  if (frequency === "Weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (frequency === "Monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  if (frequency === "Quarterly") date.setUTCMonth(date.getUTCMonth() + 3);
  if (frequency === "Yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

export function listRecurringPlans(includeInactive = false) {
  return readStore().plans
    .filter((plan) => includeInactive || plan.active)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

export function upsertRecurringPlan(input: Omit<RecurringPlan, "id" | "createdAt" | "active"> & { id?: string; active?: boolean }) {
  const store = readStore();
  const name = input.name.trim();
  if (!name) throw new Error("Plan name is required.");
  if (!input.nextDueDate) throw new Error("Next due date is required.");

  if (input.id) {
    const existing = store.plans.find((plan) => plan.id === input.id);
    if (existing) {
      store.plans = store.plans.map((plan) =>
        plan.id === input.id
          ? {
              ...plan,
              ...input,
              name,
              active: input.active ?? plan.active,
            }
          : plan,
      );
    } else {
      store.plans.unshift({
        ...input,
        id: input.id,
        name,
        active: input.active ?? true,
        createdAt: new Date().toISOString(),
      });
    }
  } else {
    store.plans.unshift({
      ...input,
      id: uid("recur"),
      name,
      active: input.active ?? true,
      createdAt: new Date().toISOString(),
    });
  }
  writeStore(store);
  return listRecurringPlans(true);
}

/** Stable yearly boiler/service plan keyed by site (+ optional asset). */
export function upsertAnnualServiceRecurringPlan(input: {
  siteId: string;
  clientId?: string;
  customer: string;
  site?: string;
  assetId?: string;
  assetName?: string;
  nextServiceDate: string;
  sourceJobId?: string;
  sourceJobRef?: string;
}) {
  const nextDueDate = input.nextServiceDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate)) {
    throw new Error("Next service date must be YYYY-MM-DD.");
  }
  const assetPart = input.assetId ? `-${input.assetId}` : "";
  const id = `recur-boiler-${input.siteId}${assetPart}`;
  const appliance = input.assetName?.trim() || "boiler";
  const name = `Annual ${appliance} service`;
  const description = [
    `Annual ${appliance} service / gas safety check`,
    input.site ? `at ${input.site}` : null,
    input.sourceJobRef ? `(from ${input.sourceJobRef})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  upsertRecurringPlan({
    id,
    kind: "Job",
    name,
    customer: input.customer.trim() || "Customer",
    clientId: input.clientId,
    siteId: input.siteId,
    site: input.site,
    description,
    frequency: "Yearly",
    nextDueDate,
    notes: [
      "Created from Field/Core next service due date.",
      input.sourceJobId ? `sourceJobId=${input.sourceJobId}` : null,
      input.assetId ? `assetId=${input.assetId}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    active: true,
  });
  return listRecurringPlans().find((plan) => plan.id === id) ?? null;
}

/** Keep yearly service plans in sync with site asset next-service dates. */
export function syncRecurringPlansFromSiteAssets() {
  const clients = getClients();
  const sites = getClientSites();
  let synced = 0;
  for (const asset of listSiteAssets()) {
    if (!asset.nextServiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(asset.nextServiceDate)) continue;
    if (!["Gas appliance", "Oil Boiler"].includes(asset.type)) continue;
    const site = sites.find((row) => row.id === asset.siteId);
    const client =
      clients.find((row) => row.id === (asset.clientId || site?.clientId)) ||
      null;
    try {
      upsertAnnualServiceRecurringPlan({
        siteId: asset.siteId,
        clientId: asset.clientId || site?.clientId,
        customer: client?.name || "Customer",
        site: site?.address || site?.name,
        assetId: asset.id,
        assetName: asset.name || asset.type,
        nextServiceDate: asset.nextServiceDate,
      });
      synced += 1;
    } catch {
      // best-effort
    }
  }
  return synced;
}

/** Due now plus upcoming within N days (for Carol's 4-week chase list). */
export function windowRecurringJobPlans(withinDays = 28, asOf = new Date().toISOString().slice(0, 10)) {
  const horizon = new Date(`${asOf}T12:00:00Z`);
  if (Number.isNaN(horizon.getTime())) return [];
  horizon.setUTCDate(horizon.getUTCDate() + Math.max(0, withinDays));
  const until = horizon.toISOString().slice(0, 10);
  return listRecurringPlans()
    .filter((plan) => plan.kind === "Job" && plan.nextDueDate <= until)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

export function dueRecurringPlans(asOf = new Date().toISOString().slice(0, 10)) {
  return listRecurringPlans().filter((plan) => plan.nextDueDate <= asOf);
}

export function upcomingRecurringPlans(withinDays = 7, asOf = new Date().toISOString().slice(0, 10)) {
  const horizon = new Date(`${asOf}T12:00:00Z`);
  if (Number.isNaN(horizon.getTime())) return [];
  horizon.setUTCDate(horizon.getUTCDate() + Math.max(0, withinDays));
  const until = horizon.toISOString().slice(0, 10);
  return listRecurringPlans().filter((plan) => plan.nextDueDate > asOf && plan.nextDueDate <= until);
}

export function markRecurringGenerated(id: string, generatedRef: string) {
  const store = readStore();
  store.plans = store.plans.map((plan) => {
    if (plan.id !== id) return plan;
    return {
      ...plan,
      lastGeneratedAt: new Date().toISOString(),
      lastGeneratedRef: generatedRef,
      nextDueDate: shiftDueDate(plan.nextDueDate, plan.frequency),
    };
  });
  writeStore(store);
  return store.plans.find((plan) => plan.id === id) ?? null;
}

export function setRecurringActive(id: string, active: boolean) {
  const store = readStore();
  store.plans = store.plans.map((plan) => (plan.id === id ? { ...plan, active } : plan));
  writeStore(store);
  return listRecurringPlans(true);
}
