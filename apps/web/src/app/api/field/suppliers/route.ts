import { NextResponse } from "next/server";

import { getHubDetailState } from "@/lib/hub-detail-store";
import { useDemoSeedData } from "@/lib/workspace-mode";

export const runtime = "nodejs";

export type FieldSupplier = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  account?: string;
  category?: string;
};

const DEFAULT_SUPPLIERS: FieldSupplier[] = [
  {
    id: "supplier-plumbase",
    name: "Plumbase",
    email: "aberdeen@plumbase.example",
    account: "EWG trade account",
    category: "Plumbing and heating",
  },
  {
    id: "supplier-pipe-center",
    name: "Pipe Center Aberdeen",
    email: "aberdeen@pipecenter.example",
    account: "Heating stock",
    category: "Heating stock",
  },
  {
    id: "supplier-wolseley",
    name: "Wolseley",
    email: "trade@wolseley.example",
    account: "Plumbing and heating",
    category: "Plumbing and heating",
  },
  {
    id: "supplier-aldrite",
    name: "Aldrite Plumbing Ltd",
    email: "orders@aldrite.example",
    account: "Bathroom materials",
    category: "Bathroom materials",
  },
  {
    id: "supplier-valve-source",
    name: "Valve Source",
    email: "sales@valvesource.example",
    account: "Specialist valves",
    category: "Specialist valves",
  },
];

function asSupplier(value: unknown, index: number): FieldSupplier | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.archived === true) return null;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return null;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `supplier-${index}-${name}`,
    name,
    email: typeof record.email === "string" ? record.email.trim() : undefined,
    phone: typeof record.phone === "string" ? record.phone.trim() : undefined,
    account: typeof record.account === "string" ? record.account.trim() : undefined,
    category: typeof record.category === "string" ? record.category.trim() : undefined,
  };
}

export function listFieldSuppliers(): FieldSupplier[] {
  const hubState = getHubDetailState();
  const hubSuppliers = Array.isArray(hubState.suppliers) ? hubState.suppliers : [];
  const fromCore = hubSuppliers
    .map((item, index) => asSupplier(item, index))
    .filter((item): item is FieldSupplier => Boolean(item))
    .sort((first, second) => first.name.localeCompare(second.name, "en-GB"));

  if (fromCore.length) return fromCore;
  if (useDemoSeedData()) return DEFAULT_SUPPLIERS;
  return [];
}

export async function GET() {
  const hubState = getHubDetailState();
  const hasCoreSuppliers = Array.isArray(hubState.suppliers) && hubState.suppliers.length > 0;
  const suppliers = listFieldSuppliers();
  return NextResponse.json({
    suppliers,
    source: hasCoreSuppliers ? "core" : suppliers.length ? "demo" : "empty",
  });
}
