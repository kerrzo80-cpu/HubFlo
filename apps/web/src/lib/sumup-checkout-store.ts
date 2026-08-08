import { loadServerStore, writeServerStore } from "@/lib/server-store";

type PendingCheckout = {
  checkoutId: string;
  checkoutReference?: string;
  invoiceId: string;
  portalToken: string;
  amount: number;
  createdAt: string;
};

type Store = {
  byCheckoutId: Record<string, PendingCheckout>;
  byCheckoutReference?: Record<string, string>;
};

const STORE = "nexa-sumup-checkouts-v1";

function read(): Store {
  const stored = loadServerStore<Partial<Store>>(STORE, { byCheckoutId: {}, byCheckoutReference: {} });
  return {
    byCheckoutId: stored.byCheckoutId && typeof stored.byCheckoutId === "object" ? stored.byCheckoutId : {},
    byCheckoutReference:
      stored.byCheckoutReference && typeof stored.byCheckoutReference === "object"
        ? stored.byCheckoutReference
        : {},
  };
}

export function rememberSumUpCheckout(entry: PendingCheckout) {
  const store = read();
  store.byCheckoutId[entry.checkoutId] = entry;
  if (entry.checkoutReference) {
    store.byCheckoutReference = store.byCheckoutReference || {};
    store.byCheckoutReference[entry.checkoutReference] = entry.checkoutId;
  }
  // Prune older than 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, row] of Object.entries(store.byCheckoutId)) {
    if (Date.parse(row.createdAt) < cutoff) {
      delete store.byCheckoutId[id];
      if (row.checkoutReference && store.byCheckoutReference?.[row.checkoutReference]) {
        delete store.byCheckoutReference[row.checkoutReference];
      }
    }
  }
  writeServerStore(STORE, store);
}

export function lookupSumUpCheckout(checkoutId: string) {
  return read().byCheckoutId[checkoutId] ?? null;
}

export function lookupSumUpCheckoutByReference(checkoutReference: string) {
  const store = read();
  const checkoutId = store.byCheckoutReference?.[checkoutReference];
  if (!checkoutId) return null;
  return store.byCheckoutId[checkoutId] ?? null;
}

export function latestCheckoutForInvoice(invoiceId: string) {
  const rows = Object.values(read().byCheckoutId)
    .filter((row) => row.invoiceId === invoiceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows[0] ?? null;
}
