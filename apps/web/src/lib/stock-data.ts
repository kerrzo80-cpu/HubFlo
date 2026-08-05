import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type StockLocationKind = "Warehouse" | "Van";

export type StockLocation = {
  id: string;
  name: string;
  kind: StockLocationKind;
  engineerName?: string;
  archived?: boolean;
};

export type StockItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  minLevel: number;
  unitCost: number;
  preferredSupplier?: string;
  catalogItemId?: string;
  archived?: boolean;
};

export type StockBalance = {
  locationId: string;
  itemId: string;
  quantity: number;
};

export type StockMovement = {
  id: string;
  at: string;
  itemId: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity: number;
  reason: "Receipt" | "Issue to job" | "Return from job" | "Transfer" | "Stocktake" | "Adjustment";
  jobRef?: string;
  poNumber?: string;
  note?: string;
  actor: string;
};

type StockStore = {
  locations: StockLocation[];
  items: StockItem[];
  balances: StockBalance[];
  movements: StockMovement[];
};

const STORE = "nexa-stock-v1";

const defaultLocations: StockLocation[] = [
  { id: "loc-warehouse", name: "Warehouse", kind: "Warehouse" },
  { id: "loc-van-chris", name: "Chris van", kind: "Van", engineerName: "Chris" },
  { id: "loc-van-murray", name: "Murray van", kind: "Van", engineerName: "Murray" },
  { id: "loc-van-raymond", name: "Raymond van", kind: "Van", engineerName: "Raymond" },
  { id: "loc-van-ryan", name: "Ryan van", kind: "Van", engineerName: "Ryan" },
];

function blankStore(): StockStore {
  return {
    locations: defaultLocations,
    items: [],
    balances: [],
    movements: [],
  };
}

function readStore(): StockStore {
  const stored = loadServerStore<StockStore>(STORE, blankStore());
  if (!stored.locations?.length) {
    return { ...stored, locations: defaultLocations };
  }
  return stored;
}

function writeStore(store: StockStore) {
  writeServerStore(STORE, store);
  return store;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function balanceKey(locationId: string, itemId: string) {
  return `${locationId}::${itemId}`;
}

function getBalance(store: StockStore, locationId: string, itemId: string) {
  return store.balances.find((row) => row.locationId === locationId && row.itemId === itemId)?.quantity ?? 0;
}

function setBalance(store: StockStore, locationId: string, itemId: string, quantity: number) {
  const next = Math.max(0, quantity);
  const existing = store.balances.find((row) => row.locationId === locationId && row.itemId === itemId);
  if (existing) {
    existing.quantity = next;
    return;
  }
  store.balances.push({ locationId, itemId, quantity: next });
}

export function getStockSnapshot() {
  const store = readStore();
  return {
    locations: store.locations.filter((item) => !item.archived),
    items: store.items.filter((item) => !item.archived),
    balances: store.balances,
    movements: [...store.movements].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200),
    lowStock: store.items
      .filter((item) => !item.archived)
      .map((item) => {
        const onHand = store.balances
          .filter((row) => row.itemId === item.id)
          .reduce((sum, row) => sum + row.quantity, 0);
        return { item, onHand, belowMin: onHand < item.minLevel };
      })
      .filter((row) => row.belowMin),
  };
}

export function upsertStockItem(input: {
  id?: string;
  sku: string;
  name: string;
  unit?: string;
  minLevel?: number;
  unitCost?: number;
  preferredSupplier?: string;
  catalogItemId?: string;
}) {
  const store = readStore();
  const sku = input.sku.trim();
  const name = input.name.trim();
  if (!sku || !name) throw new Error("SKU and name are required.");

  if (input.id) {
    store.items = store.items.map((item) =>
      item.id === input.id
        ? {
            ...item,
            sku,
            name,
            unit: input.unit?.trim() || item.unit,
            minLevel: input.minLevel ?? item.minLevel,
            unitCost: input.unitCost ?? item.unitCost,
            preferredSupplier:
              input.preferredSupplier !== undefined
                ? input.preferredSupplier.trim() || undefined
                : item.preferredSupplier,
            catalogItemId: input.catalogItemId ?? item.catalogItemId,
          }
        : item,
    );
  } else {
    if (store.items.some((item) => item.sku.toLowerCase() === sku.toLowerCase() && !item.archived)) {
      throw new Error(`SKU ${sku} already exists.`);
    }
    store.items.unshift({
      id: uid("stock-item"),
      sku,
      name,
      unit: input.unit?.trim() || "each",
      minLevel: input.minLevel ?? 0,
      unitCost: input.unitCost ?? 0,
      preferredSupplier: input.preferredSupplier?.trim() || undefined,
      catalogItemId: input.catalogItemId?.trim() || undefined,
    });
  }
  return writeStore(store);
}

export function recordStockMovement(input: {
  itemId: string;
  quantity: number;
  reason: StockMovement["reason"];
  fromLocationId?: string;
  toLocationId?: string;
  jobRef?: string;
  poNumber?: string;
  note?: string;
  actor?: string;
}) {
  const store = readStore();
  const qty = Math.abs(Number(input.quantity) || 0);
  if (!qty) throw new Error("Quantity must be greater than zero.");
  const item = store.items.find((row) => row.id === input.itemId && !row.archived);
  if (!item) throw new Error("Stock item not found.");

  if (input.reason === "Transfer") {
    if (!input.fromLocationId || !input.toLocationId) throw new Error("Transfer needs from and to locations.");
    const available = getBalance(store, input.fromLocationId, input.itemId);
    if (available < qty) throw new Error(`Only ${available} available to transfer.`);
    setBalance(store, input.fromLocationId, input.itemId, available - qty);
    setBalance(store, input.toLocationId, input.itemId, getBalance(store, input.toLocationId, input.itemId) + qty);
  } else if (input.reason === "Receipt" || input.reason === "Adjustment") {
    if (!input.toLocationId) throw new Error("Receipt needs a destination location.");
    setBalance(store, input.toLocationId, input.itemId, getBalance(store, input.toLocationId, input.itemId) + qty);
  } else if (input.reason === "Issue to job") {
    if (!input.fromLocationId) throw new Error("Issue needs a source location.");
    if (!input.jobRef?.trim()) throw new Error("Issue needs a job reference.");
    const available = getBalance(store, input.fromLocationId, input.itemId);
    if (available < qty) throw new Error(`Only ${available} available to issue.`);
    setBalance(store, input.fromLocationId, input.itemId, available - qty);
  } else if (input.reason === "Return from job") {
    if (!input.toLocationId) throw new Error("Return needs a destination location.");
    if (!input.jobRef?.trim()) throw new Error("Return needs a job reference.");
    setBalance(store, input.toLocationId, input.itemId, getBalance(store, input.toLocationId, input.itemId) + qty);
  } else if (input.reason === "Stocktake") {
    if (!input.toLocationId) throw new Error("Stocktake needs a location.");
    setBalance(store, input.toLocationId, input.itemId, qty);
  }

  store.movements.unshift({
    id: uid("stock-move"),
    at: new Date().toISOString(),
    itemId: input.itemId,
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    quantity: qty,
    reason: input.reason,
    jobRef: input.jobRef,
    poNumber: input.poNumber,
    note: input.note,
    actor: input.actor?.trim() || "NeXa",
  });

  return writeStore(store);
}

export function receivePurchaseIntoStock(input: {
  lines: Array<{
    sku: string;
    name: string;
    quantity: number;
    unitCost?: number;
    unit?: string;
    stockItemId?: string;
    catalogItemId?: string;
  }>;
  locationId?: string;
  poNumber?: string;
  jobRef?: string;
  actor?: string;
}) {
  let store = readStore();
  const locationId = input.locationId || store.locations.find((row) => row.kind === "Warehouse")?.id;
  if (!locationId) throw new Error("No warehouse location configured.");

  for (const line of input.lines) {
    if (!line.quantity) continue;
    store = readStore();
    let item =
      (line.stockItemId
        ? store.items.find((row) => row.id === line.stockItemId && !row.archived)
        : undefined) ||
      (line.sku.trim()
        ? store.items.find((row) => row.sku.toLowerCase() === line.sku.trim().toLowerCase() && !row.archived)
        : undefined) ||
      (line.catalogItemId
        ? store.items.find((row) => row.catalogItemId === line.catalogItemId && !row.archived)
        : undefined);

    if (!item) {
      item = {
        id: uid("stock-item"),
        sku: line.sku.trim() || uid("sku"),
        name: line.name.trim() || "PO receipt item",
        unit: line.unit || "each",
        minLevel: 0,
        unitCost: line.unitCost ?? 0,
        catalogItemId: line.catalogItemId,
      };
      store.items.unshift(item);
      writeStore(store);
    } else if (line.unitCost !== undefined || line.catalogItemId) {
      store.items = store.items.map((row) =>
        row.id === item!.id
          ? {
              ...row,
              unitCost: line.unitCost ?? row.unitCost,
              catalogItemId: line.catalogItemId || row.catalogItemId,
              name: line.name.trim() || row.name,
            }
          : row,
      );
      writeStore(store);
    }

    recordStockMovement({
      itemId: item.id,
      quantity: line.quantity,
      reason: "Receipt",
      toLocationId: locationId,
      poNumber: input.poNumber,
      jobRef: input.jobRef,
      actor: input.actor,
      note: "Goods receipt from purchase order",
    });
  }
  return getStockSnapshot();
}

export function archiveStockItem(id: string) {
  const store = readStore();
  const item = store.items.find((row) => row.id === id);
  if (!item) throw new Error("Stock item not found.");
  item.archived = true;
  writeStore(store);
  return getStockSnapshot();
}

export function upsertStockLocation(input: {
  id?: string;
  name: string;
  kind: StockLocationKind;
  engineerName?: string;
}) {
  const store = readStore();
  const name = input.name.trim();
  if (!name) throw new Error("Location name is required.");
  if (input.id) {
    store.locations = store.locations.map((location) =>
      location.id === input.id
        ? {
            ...location,
            name,
            kind: input.kind,
            engineerName: input.engineerName?.trim() || undefined,
          }
        : location,
    );
  } else {
    store.locations.push({
      id: uid("loc"),
      name,
      kind: input.kind,
      engineerName: input.engineerName?.trim() || undefined,
    });
  }
  writeStore(store);
  return getStockSnapshot();
}

export function archiveStockLocation(id: string) {
  const store = readStore();
  const location = store.locations.find((row) => row.id === id);
  if (!location) throw new Error("Location not found.");
  if (location.kind === "Warehouse" && store.locations.filter((row) => row.kind === "Warehouse" && !row.archived).length <= 1) {
    throw new Error("Keep at least one warehouse location.");
  }
  location.archived = true;
  writeStore(store);
  return getStockSnapshot();
}

export { balanceKey };
