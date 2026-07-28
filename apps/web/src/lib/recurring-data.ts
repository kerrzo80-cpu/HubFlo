import { loadServerStore, writeServerStore } from "@/lib/server-store";

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
      id: uid("recur"),
      name,
      active: input.active ?? true,
      createdAt: new Date().toISOString(),
    });
  }
  writeStore(store);
  return listRecurringPlans(true);
}

export function dueRecurringPlans(asOf = new Date().toISOString().slice(0, 10)) {
  return listRecurringPlans().filter((plan) => plan.nextDueDate <= asOf);
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
