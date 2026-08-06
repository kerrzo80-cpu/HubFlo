import { loadServerStore, writeServerStore } from "@/lib/server-store";

type PendingCheckout = {
  checkoutId: string;
  invoiceId: string;
  portalToken: string;
  amount: number;
  createdAt: string;
};

type Store = {
  byCheckoutId: Record<string, PendingCheckout>;
};

const STORE = "nexa-sumup-checkouts-v1";

function read(): Store {
  const stored = loadServerStore<Partial<Store>>(STORE, { byCheckoutId: {} });
  return { byCheckoutId: stored.byCheckoutId && typeof stored.byCheckoutId === "object" ? stored.byCheckoutId : {} };
}

export function rememberSumUpCheckout(entry: PendingCheckout) {
  const store = read();
  store.byCheckoutId[entry.checkoutId] = entry;
  // Prune older than 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, row] of Object.entries(store.byCheckoutId)) {
    if (Date.parse(row.createdAt) < cutoff) delete store.byCheckoutId[id];
  }
  writeServerStore(STORE, store);
}

export function lookupSumUpCheckout(checkoutId: string) {
  return read().byCheckoutId[checkoutId] ?? null;
}

export function latestCheckoutForInvoice(invoiceId: string) {
  const rows = Object.values(read().byCheckoutId)
    .filter((row) => row.invoiceId === invoiceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows[0] ?? null;
}
