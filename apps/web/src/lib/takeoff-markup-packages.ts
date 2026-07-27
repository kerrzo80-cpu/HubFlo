import type {
  TakeoffMarkupPackageChildItem,
  TakeoffMarkupPackageInstance,
  TakeoffMarkupSymbol,
  TakeoffMarkupSymbolCategory,
  TakeoffMaterialAllowance,
  TakeoffSupplierRequestItem,
} from "@/lib/takeoff-data";

export type TakeoffMarkupPackageTemplate = {
  id: string;
  title: string;
  summary: string;
  match: (kind: string, category: TakeoffMarkupSymbolCategory) => boolean;
  section: string;
  childItems: TakeoffMarkupPackageChildItem[];
};

export const markupPackageTemplates: TakeoffMarkupPackageTemplate[] = [
  {
    id: "boiler-package",
    title: "Boiler package",
    summary: "Flue, controls, filter, condensate and gas connection typically needed with a boiler.",
    section: "Heating / boiler & radiators",
    match: (kind) => /boiler/.test(kind) && !/flue|filter|sensor|thermostat/.test(kind),
    childItems: [
      { id: "flue-kit", description: "Boiler flue kit / terminal — route TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "controls", description: "Programmer / room thermostat / controls pack — spec TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "mag-filter", description: "Magnetic system filter", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "condensate", description: "Condensate pipe and fittings — provisional", quantity: 6, unit: "m", supplierRequired: true, defaultSelected: true },
      { id: "gas-isolation", description: "Gas isolation valve and connection fittings — size TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "filling-loop", description: "Filling loop / temporary filling connection", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "chemicals", description: "System cleaner and inhibitor", quantity: 1, unit: "nr", supplierRequired: false, defaultSelected: true },
    ],
  },
  {
    id: "soil-stack-package",
    title: "Soil stack tap-in",
    summary: "Boss, adaptor and branch fittings needed to tap a waste into the stack.",
    section: "Sanitary & drainage",
    match: (kind) => /soil stack|stack boss|strap boss|waste stack/.test(kind),
    childItems: [
      { id: "strap-boss", description: "Strap boss / boss adaptor for waste connection", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "boss-adaptor", description: "Boss adaptor 32/40mm — size TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "waste-branch", description: "Waste branch / stack connector", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "access-cap", description: "Access cap / inspection fitting", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: false },
      { id: "solvent", description: "Solvent weld cement and cleaner", quantity: 1, unit: "nr", supplierRequired: false, defaultSelected: true },
      { id: "clips", description: "Pipe clips and fixing sundries", quantity: 1, unit: "nr", supplierRequired: false, defaultSelected: true },
    ],
  },
  {
    id: "bath-package",
    title: "Bath package",
    summary: "Waste, trap, taps and feed connections that go with a bath.",
    section: "Sanitary ware",
    match: (kind) => /(^|\s)bath(\s|$)|bath mixer/.test(kind),
    childItems: [
      { id: "bath-waste", description: "Bath waste and overflow", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "bath-trap", description: "Bath trap 40mm", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "bath-taps", description: "Bath taps / bath mixer — specification TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "isolation", description: "15mm hot/cold isolation valves", quantity: 2, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "tap-connectors", description: "Flexible tap connectors", quantity: 2, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "waste-pipe", description: "40mm waste pipe and fittings — provisional", quantity: 3, unit: "m", supplierRequired: true, defaultSelected: true },
      { id: "sundries", description: "Sealant, fixings and bath fitting sundries", quantity: 1, unit: "nr", supplierRequired: false, defaultSelected: true },
    ],
  },
  {
    id: "shower-package",
    title: "Shower package",
    summary: "Trap, waste, valve connections and sundries typically needed with a shower tray.",
    section: "Sanitary ware",
    match: (kind) => /shower tray|shower cubicle|shower enclosure/.test(kind),
    childItems: [
      { id: "shower-trap", description: "Shower trap 40/50mm — size TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "waste-pipe", description: "40mm waste pipe and fittings — provisional", quantity: 3, unit: "m", supplierRequired: true, defaultSelected: true },
      { id: "shower-valve", description: "Shower valve / mixer — specification TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "isolation", description: "15mm hot/cold isolation valves", quantity: 2, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "flexi", description: "Flexible shower hose / connectors", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: false },
      { id: "sundries", description: "Silicone, fixings and shower tray sundries", quantity: 1, unit: "nr", supplierRequired: false, defaultSelected: true },
    ],
  },
  {
    id: "radiator-package",
    title: "Radiator package",
    summary: "Valve set, tails and connection fittings for a radiator install.",
    section: "Heating / boiler & radiators",
    match: (kind) => /radiator|towel rad|convector/.test(kind),
    childItems: [
      { id: "valve-set", description: "TRV and lockshield valve set", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "tails", description: "Radiator tails / adapters", quantity: 2, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "brackets", description: "Radiator brackets and wall fixings", quantity: 1, unit: "nr", supplierRequired: false, defaultSelected: true },
      { id: "pipe-fittings", description: "15mm pipe fittings for radiator connections — provisional", quantity: 6, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "pipe-route", description: "15mm pipe to radiator — provisional route", quantity: 3, unit: "m", supplierRequired: true, defaultSelected: false },
    ],
  },
  {
    id: "cylinder-package",
    title: "Cylinder package",
    summary: "Controls, vessel/kit, tundish and connection fittings for a cylinder.",
    section: "Hot water / cylinder",
    match: (kind) => /cylinder/.test(kind),
    childItems: [
      { id: "stat", description: "Cylinder thermostat", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "zone-valve", description: "2-port motorised zone valve", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "expansion", description: "Expansion vessel / unvented kit — specification TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "tundish", description: "Tundish and discharge pipe fittings", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "drain-isolation", description: "Drain cock and isolation valves", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "connections", description: "Cylinder connection pipe and fittings — provisional", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
    ],
  },
  {
    id: "basin-package",
    title: "Basin package",
    summary: "Waste, taps and feed connections for a basin.",
    section: "Sanitary ware",
    match: (kind) => /(^|\s)basin(\s|$)|wash hand/.test(kind),
    childItems: [
      { id: "basin-waste", description: "Basin waste", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "basin-trap", description: "Basin trap 32mm", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "basin-taps", description: "Basin taps / mixer — specification TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "isolation", description: "15mm hot/cold isolation valves", quantity: 2, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "tap-connectors", description: "Flexible tap connectors", quantity: 2, unit: "nr", supplierRequired: true, defaultSelected: true },
    ],
  },
  {
    id: "kitchen-sink-package",
    title: "Kitchen sink package",
    summary: "Trap, taps and feed connections for a kitchen sink.",
    section: "Sanitary ware",
    match: (kind) => /kitchen sink|(^|\s)sink(\s|$)/.test(kind) && !/basin/.test(kind),
    childItems: [
      { id: "sink-waste", description: "Sink waste", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "sink-trap", description: "Sink trap 40mm", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "sink-taps", description: "Kitchen taps / mixer — specification TBC", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "isolation", description: "15mm hot/cold isolation valves", quantity: 2, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "tap-connectors", description: "Flexible tap connectors", quantity: 2, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "waste-pipe", description: "40mm waste pipe and fittings — provisional", quantity: 2, unit: "m", supplierRequired: true, defaultSelected: true },
    ],
  },
  {
    id: "wc-package",
    title: "WC package",
    summary: "Pan connector, cistern fittings and isolation for a WC.",
    section: "Sanitary ware",
    match: (kind) => /(^|\s)wc(\s|$)|toilet|closet/.test(kind),
    childItems: [
      { id: "pan-connector", description: "WC pan connector", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "cistern-kit", description: "Cistern inlet valve / flush fittings — if not supplied", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: false },
      { id: "isolation", description: "15mm cold isolation valve", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
      { id: "flexi", description: "Flexible cistern connector", quantity: 1, unit: "nr", supplierRequired: true, defaultSelected: true },
    ],
  },
];

/** Parents with an active package own the RFQ list — linked auto fittings should not also hit BoQ. */
export function packageOwnedParentSymbolIds(
  packages: TakeoffMarkupPackageInstance[] | undefined,
) {
  return new Set(
    (packages ?? [])
      .filter((item) => item.status === "suggested" || item.status === "accepted")
      .map((item) => item.parentSymbolId),
  );
}

export function isAutoFittingOwnedByPackage(
  symbol: Pick<TakeoffMarkupSymbol, "autoGenerated" | "linkedSymbolId">,
  packageParentIds: Set<string>,
) {
  return Boolean(
    symbol.autoGenerated
    && symbol.linkedSymbolId
    && packageParentIds.has(symbol.linkedSymbolId),
  );
}

function makePackageId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function findMarkupPackageTemplate(kind: string, category: TakeoffMarkupSymbolCategory) {
  const normalised = kind.trim().toLowerCase();
  return markupPackageTemplates.find((template) => template.match(normalised, category)) ?? null;
}

export function createSuggestedPackageForSymbol(symbol: TakeoffMarkupSymbol): TakeoffMarkupPackageInstance | null {
  const template = findMarkupPackageTemplate(String(symbol.kind), symbol.category);
  if (!template) return null;
  const stamped = new Date().toISOString();
  return {
    id: `markup-package-${symbol.id}-${template.id}`,
    templateId: template.id,
    title: template.title,
    summary: template.summary,
    parentSymbolId: symbol.id,
    parentKind: symbol.kind,
    parentCategory: symbol.category,
    status: "suggested",
    section: template.section,
    childItems: template.childItems.map((item) => ({
      ...item,
      selected: item.defaultSelected !== false,
    })),
    createdAt: stamped,
    updatedAt: stamped,
  };
}

export function ensureSuggestedPackage(
  packages: TakeoffMarkupPackageInstance[] | undefined,
  symbol: TakeoffMarkupSymbol,
): TakeoffMarkupPackageInstance[] {
  const current = packages ?? [];
  if (current.some((item) => item.parentSymbolId === symbol.id && item.status !== "dismissed")) {
    return current;
  }
  const suggested = createSuggestedPackageForSymbol(symbol);
  if (!suggested) return current;
  return [
    ...current.filter((item) => !(item.parentSymbolId === symbol.id && item.status === "dismissed")),
    suggested,
  ];
}

export function packagesForSymbol(
  packages: TakeoffMarkupPackageInstance[] | undefined,
  symbolId: string,
) {
  return (packages ?? []).filter((item) => item.parentSymbolId === symbolId && item.status !== "dismissed");
}

export function togglePackageChild(
  packages: TakeoffMarkupPackageInstance[],
  packageId: string,
  childId: string,
  selected: boolean,
): TakeoffMarkupPackageInstance[] {
  const stamped = new Date().toISOString();
  return packages.map((item) => {
    if (item.id !== packageId) return item;
    return {
      ...item,
      updatedAt: stamped,
      childItems: item.childItems.map((child) => (
        child.id === childId ? { ...child, selected } : child
      )),
    };
  });
}

export function acceptMarkupPackage(
  packages: TakeoffMarkupPackageInstance[],
  packageId: string,
): TakeoffMarkupPackageInstance[] {
  const stamped = new Date().toISOString();
  return packages.map((item) => (
    item.id === packageId
      ? { ...item, status: "accepted" as const, updatedAt: stamped }
      : item
  ));
}

export function dismissMarkupPackage(
  packages: TakeoffMarkupPackageInstance[],
  packageId: string,
): TakeoffMarkupPackageInstance[] {
  const stamped = new Date().toISOString();
  return packages.map((item) => (
    item.id === packageId
      ? { ...item, status: "dismissed" as const, updatedAt: stamped }
      : item
  ));
}

export function materialAllowancesFromAcceptedPackages(
  packages: TakeoffMarkupPackageInstance[] | undefined,
  existing: TakeoffMaterialAllowance[],
): TakeoffMaterialAllowance[] {
  const accepted = (packages ?? []).filter((item) => item.status === "accepted");
  return accepted.flatMap((pack) => (
    pack.childItems
      .filter((child) => child.selected)
      .map((child) => {
        const id = `markup-package-material-${pack.id}-${child.id}`;
        const existingLine = existing.find((line) => line.id === id);
        return {
          id,
          section: child.section || pack.section,
          description: `${child.description} · ${String(pack.parentKind)} package`,
          quantity: child.quantity,
          unit: child.unit,
          unitCost: existingLine?.unitCost ?? 0,
          markupPercent: existingLine?.markupPercent ?? 30,
          supplierRequired: existingLine?.supplierRequired ?? child.supplierRequired ?? true,
          preferredSupplier: existingLine?.preferredSupplier ?? "",
        } satisfies TakeoffMaterialAllowance;
      })
  ));
}

export function supplierRequestsFromPackageMaterials(
  materials: TakeoffMaterialAllowance[],
  existing: TakeoffSupplierRequestItem[],
): TakeoffSupplierRequestItem[] {
  return materials.map((line) => {
    const id = `markup-package-rfq-${line.id}`;
    const existingLine = existing.find((item) => item.id === id || item.linkedMaterialId === line.id);
    return {
      id: existingLine?.id ?? id,
      supplier: existingLine?.supplier ?? line.preferredSupplier ?? "",
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      linkedMaterialId: existingLine?.linkedMaterialId ?? line.id,
      notes: "From Markup package",
    } satisfies TakeoffSupplierRequestItem;
  });
}

export function prunePackagesForMissingSymbols(
  packages: TakeoffMarkupPackageInstance[] | undefined,
  symbols: TakeoffMarkupSymbol[],
) {
  const ids = new Set(symbols.map((symbol) => symbol.id));
  return (packages ?? []).filter((item) => ids.has(item.parentSymbolId));
}

export function normaliseMarkupPackages(
  packages: TakeoffMarkupPackageInstance[] | undefined,
): TakeoffMarkupPackageInstance[] {
  if (!Array.isArray(packages)) return [];
  return packages
    .filter((item) => item && typeof item === "object" && typeof item.id === "string" && typeof item.parentSymbolId === "string")
    .map((item) => ({
      ...item,
      childItems: Array.isArray(item.childItems)
        ? item.childItems.map((child) => ({
          ...child,
          selected: Boolean(child.selected),
          quantity: Number(child.quantity) > 0 ? Number(child.quantity) : 1,
          unit: String(child.unit || "nr"),
          description: String(child.description || "").trim() || "Package item",
        }))
        : [],
    }));
}
