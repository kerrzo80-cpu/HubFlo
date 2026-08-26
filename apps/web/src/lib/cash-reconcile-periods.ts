import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type CashReconcilePeriodRecord = {
  periodKey: string;
  reconciledAt: string;
  reconciledBy?: string;
};

type CashReconcilePeriodStore = {
  lastReconciled?: CashReconcilePeriodRecord;
  history: CashReconcilePeriodRecord[];
};

const STORE = "nexa-cash-reconcile-periods-v1";

const defaultStore: CashReconcilePeriodStore = {
  history: [],
};

function readStore(): CashReconcilePeriodStore {
  const stored = loadServerStore<Partial<CashReconcilePeriodStore>>(STORE, defaultStore);
  const history = Array.isArray(stored.history) ? stored.history : [];
  return {
    lastReconciled: stored.lastReconciled,
    history,
  };
}

function persistStore(store: CashReconcilePeriodStore) {
  writeServerStore(STORE, store);
}

export function getLastReconciled(): CashReconcilePeriodRecord | null {
  const store = readStore();
  return store.lastReconciled ? { ...store.lastReconciled } : null;
}

export function markReconciled(periodKey: string, reconciledBy?: string): CashReconcilePeriodRecord {
  const cleaned = String(periodKey || "").trim();
  if (!cleaned) {
    throw new Error("periodKey is required.");
  }

  const record: CashReconcilePeriodRecord = {
    periodKey: cleaned,
    reconciledAt: new Date().toISOString(),
    reconciledBy: reconciledBy?.trim() || undefined,
  };

  const store = readStore();
  const next: CashReconcilePeriodStore = {
    lastReconciled: record,
    history: [record, ...store.history.filter((entry) => entry.periodKey !== cleaned)].slice(0, 24),
  };
  persistStore(next);
  return { ...record };
}

export function resetCashReconcilePeriodsForTests(next: Partial<CashReconcilePeriodStore> = {}) {
  persistStore({
    lastReconciled: next.lastReconciled,
    history: next.history ?? [],
  });
}
