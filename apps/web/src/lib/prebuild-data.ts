import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { draftsToPrebuildKits, parseKitsFromXlsxBuffer } from "@/lib/kit-xlsx-import";

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

function slugId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `kit-${slug || "item"}`;
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

function normalizeKit(kit: PrebuildKit): PrebuildKit {
  return {
    ...kit,
    id: kit.id || uid("kit"),
    name: String(kit.name || "Kit").trim() || "Kit",
    category: String(kit.category || "General").trim() || "General",
    lines: Array.isArray(kit.lines)
      ? kit.lines.filter((line) => line && String(line.description || "").trim())
      : [],
  };
}

function readStore(): PrebuildStore {
  const stored = loadServerStore<PrebuildStore>(STORE, defaults);
  const kits = (stored.kits?.length ? stored.kits : defaults.kits).map(normalizeKit);
  return { kits };
}

function writeStore(store: PrebuildStore) {
  writeServerStore(STORE, store);
  return store;
}

export function listPrebuilds(includeArchived = false) {
  const store = readStore();
  return store.kits.filter((kit) => includeArchived || !kit.archived);
}

/** Product name: Kits (store/API still use prebuild ids for compatibility). */
export const listKits = listPrebuilds;

export function upsertPrebuild(input: {
  id?: string;
  name: string;
  category?: string;
  notes?: string;
  lines?: Array<Partial<PrebuildLine> & { kind: PrebuildLineKind; description: string }>;
}) {
  const store = readStore();
  const name = input.name.trim();
  if (!name) throw new Error("Kit name is required.");
  const lines: PrebuildLine[] = (input.lines || [])
    .filter((line) => line?.description?.trim())
    .map((line) => {
      const rawQty = Number(line.quantity);
      const quantity = Number.isFinite(rawQty) ? Math.max(0, rawQty) : line.kind === "Labour" ? 1 : 1;
      return {
        id: line.id || uid("pbl"),
        kind: line.kind,
        description: line.description.trim(),
        quantity,
        unitCost: Math.max(0, Number(line.unitCost) || 0),
        unitSell: line.unitSell !== undefined ? Math.max(0, Number(line.unitSell) || 0) : undefined,
        unit: line.unit?.trim() || (line.kind === "Labour" ? "hrs" : "each"),
      };
    })
    .filter((line) => line.kind === "Labour" || line.quantity > 0);
  if (input.id) {
    const index = store.kits.findIndex((kit) => kit.id === input.id);
    if (index < 0) throw new Error("Kit not found.");
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
      id: uid("kit"),
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
  if (!kit) throw new Error("Kit not found.");
  kit.archived = true;
  return writeStore(store);
}

/**
 * Import kits from the office Pre builds .xlsx template.
 * merge = upsert by kit name (case-insensitive); replace = archive existing then insert imported.
 */
export function importKitsFromXlsx(
  buffer: Buffer,
  options?: { mode?: "merge" | "replace"; fileName?: string },
) {
  const mode = options?.mode === "replace" ? "replace" : "merge";
  const parsed = parseKitsFromXlsxBuffer(buffer, options?.fileName || "kits.xlsx");
  const store = readStore();

  if (mode === "replace") {
    for (const kit of store.kits) kit.archived = true;
  }

  const usedIds = new Set(store.kits.map((kit) => kit.id));
  const idForName = (name: string) => {
    const base = slugId(name);
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let n = 2;
    while (usedIds.has(`${base}-${n}`)) n += 1;
    const id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };

  const incoming = draftsToPrebuildKits(parsed.kits, idForName);
  let created = 0;
  let updated = 0;

  for (const kit of incoming) {
    const existingIndex = store.kits.findIndex(
      (row) => !row.archived && row.name.trim().toLowerCase() === kit.name.trim().toLowerCase(),
    );
    if (existingIndex >= 0) {
      const current = store.kits[existingIndex]!;
      store.kits[existingIndex] = {
        ...current,
        category: kit.category || current.category,
        notes: kit.notes || current.notes,
        lines: kit.lines,
        archived: false,
      };
      updated += 1;
    } else {
      store.kits.unshift(kit);
      created += 1;
    }
  }

  writeStore(store);
  return {
    kits: listPrebuilds(false),
    created,
    updated,
    imported: incoming.length,
    skippedRows: parsed.skippedRows,
    skippedOptional: parsed.skippedOptional,
    rowErrors: parsed.rowErrors,
    sheetName: parsed.sheetName,
    mode,
  };
}
