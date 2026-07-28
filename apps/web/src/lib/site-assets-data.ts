import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type SiteAssetType = "Gas appliance" | "Oil Boiler" | "Pipework" | "Cylinder" | "Controls" | "Other";

export type SiteAsset = {
  id: string;
  siteId: string;
  clientId?: string;
  type: SiteAssetType;
  name: string;
  make?: string;
  model?: string;
  serialNumber?: string;
  locationNote?: string;
  installDate?: string;
  lastServiceDate?: string;
  nextServiceDate?: string;
  warrantyUntil?: string;
  notes?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
};

type AssetStore = {
  assets: SiteAsset[];
};

const STORE = "nexa-site-assets-v1";

function readStore(): AssetStore {
  return loadServerStore<AssetStore>(STORE, { assets: [] });
}

function writeStore(store: AssetStore) {
  writeServerStore(STORE, store);
  return store;
}

function uid() {
  return `asset-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

export function listSiteAssets(filters?: { siteId?: string; clientId?: string }) {
  const assets = readStore().assets.filter((asset) => !asset.archived);
  return assets.filter((asset) => {
    if (filters?.siteId && asset.siteId !== filters.siteId) return false;
    if (filters?.clientId && asset.clientId && asset.clientId !== filters.clientId) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertSiteAsset(input: Omit<SiteAsset, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
  const store = readStore();
  const now = new Date().toISOString();
  const name = input.name.trim();
  if (!name) throw new Error("Asset name is required.");
  if (!input.siteId) throw new Error("Site is required.");

  if (input.id) {
    store.assets = store.assets.map((asset) =>
      asset.id === input.id
        ? {
            ...asset,
            ...input,
            name,
            updatedAt: now,
          }
        : asset,
    );
  } else {
    store.assets.unshift({
      ...input,
      id: uid(),
      name,
      createdAt: now,
      updatedAt: now,
    });
  }
  writeStore(store);
  return listSiteAssets({ siteId: input.siteId });
}

export function archiveSiteAsset(id: string) {
  const store = readStore();
  const current = store.assets.find((asset) => asset.id === id);
  store.assets = store.assets.map((asset) =>
    asset.id === id ? { ...asset, archived: true, updatedAt: new Date().toISOString() } : asset,
  );
  writeStore(store);
  return listSiteAssets(current?.siteId ? { siteId: current.siteId } : undefined);
}

export function dueSiteAssets(asOf = new Date().toISOString().slice(0, 10), withinDays = 0) {
  const horizon = new Date(`${asOf}T12:00:00Z`);
  if (!Number.isNaN(horizon.getTime()) && withinDays > 0) {
    horizon.setUTCDate(horizon.getUTCDate() + withinDays);
  }
  const until = withinDays > 0 ? horizon.toISOString().slice(0, 10) : asOf;
  return listSiteAssets()
    .filter((asset) => asset.nextServiceDate && asset.nextServiceDate <= until)
    .sort((a, b) => String(a.nextServiceDate).localeCompare(String(b.nextServiceDate)));
}
