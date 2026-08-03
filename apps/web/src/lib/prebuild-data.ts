import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type PrebuildLineKind = "Material" | "Labour";

export type PrebuildLine = {
  id: string;
  kind: PrebuildLineKind;
  description: string;
  quantity: number;
  unitCost: number;
  unitSell?: number;
  unit?: string;
};

export type PrebuildKit = {
  id: string;
  name: string;
  category: string;
  notes?: string;
  lines: PrebuildLine[];
  archived?: boolean;
};

type PrebuildStore = {
  kits: PrebuildKit[];
};

const STORE = "nexa-prebuilds-v1";

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

const defaults: PrebuildStore = {
  kits: [
    {
      id: "pb-boiler-combi",
      name: "Combi boiler install kit",
      category: "Boiler",
      notes: "Typical materials + first-fix labour for a like-for-like combi swap.",
      lines: [
        { id: "pbl-1", kind: "Material", description: "Boiler install kit / valves", quantity: 1, unitCost: 1180, unitSell: 1560, unit: "each" },
        { id: "pbl-2", kind: "Material", description: "Flue kit / terminal", quantity: 1, unitCost: 185, unitSell: 260, unit: "each" },
        { id: "pbl-3", kind: "Material", description: "Condensate pipe & fittings", quantity: 1, unitCost: 28, unitSell: 48, unit: "lot" },
        { id: "pbl-4", kind: "Labour", description: "Boiler swap labour", quantity: 8, unitCost: 40, unitSell: 52, unit: "hrs" },
      ],
    },
    {
      id: "pb-cylinder",
      name: "Unvented cylinder package",
      category: "Hot water",
      lines: [
        { id: "pbl-5", kind: "Material", description: "Expansion vessel / unvented kit", quantity: 1, unitCost: 210, unitSell: 295, unit: "each" },
        { id: "pbl-6", kind: "Material", description: "Tundish and discharge fittings", quantity: 1, unitCost: 45, unitSell: 72, unit: "lot" },
        { id: "pbl-7", kind: "Labour", description: "Cylinder install labour", quantity: 6, unitCost: 40, unitSell: 52, unit: "hrs" },
      ],
    },
  ],
};

function readStore(): PrebuildStore {
  const stored = loadServerStore<PrebuildStore>(STORE, defaults);
  return {
    kits: stored.kits?.length ? stored.kits : defaults.kits,
  };
}

function writeStore(store: PrebuildStore) {
  writeServerStore(STORE, store);
  return store;
}

export function listPrebuilds(includeArchived = false) {
  const store = readStore();
  return store.kits.filter((kit) => includeArchived || !kit.archived);
}

export function upsertPrebuild(input: {
  id?: string;
  name: string;
  category?: string;
  notes?: string;
  lines?: Array<Partial<PrebuildLine> & { kind: PrebuildLineKind; description: string }>;
}) {
  const store = readStore();
  const name = input.name.trim();
  if (!name) throw new Error("Pre-build name is required.");
  const lines: PrebuildLine[] = (input.lines || [])
    .filter((line) => line.description.trim())
    .map((line) => ({
      id: line.id || uid("pbl"),
      kind: line.kind,
      description: line.description.trim(),
      quantity: Math.max(0, Number(line.quantity) || 1),
      unitCost: Math.max(0, Number(line.unitCost) || 0),
      unitSell: line.unitSell !== undefined ? Math.max(0, Number(line.unitSell) || 0) : undefined,
      unit: line.unit?.trim() || (line.kind === "Labour" ? "hrs" : "each"),
    }));
  if (input.id) {
    const index = store.kits.findIndex((kit) => kit.id === input.id);
    if (index < 0) throw new Error("Pre-build not found.");
    const current = store.kits[index]!;
    store.kits[index] = {
      ...current,
      name,
      category: input.category?.trim() || current.category || "General",
      notes: input.notes?.trim() || undefined,
      lines: lines.length ? lines : current.lines,
    };
  } else {
    store.kits.unshift({
      id: uid("pb"),
      name,
      category: input.category?.trim() || "General",
      notes: input.notes?.trim() || undefined,
      lines,
    });
  }
  return writeStore(store);
}

export function archivePrebuild(id: string) {
  const store = readStore();
  const kit = store.kits.find((row) => row.id === id);
  if (!kit) throw new Error("Pre-build not found.");
  kit.archived = true;
  return writeStore(store);
}
