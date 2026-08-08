/**
 * Client-safe soft guide prices — no SQLite / server store.
 * Full rate-library matching stays in ai-guide-prices.ts (server only).
 */

import type { KitLine, KitPricingSource } from "@/lib/heat-design/types";

function softGuide(description: string, unit: string): number {
  const hay = description.toLowerCase();
  if (unit === "m") {
    if (hay.includes("insulation") || hay.includes("lagging")) return 1.85;
    if (hay.includes("15")) return 4.2;
    if (hay.includes("22")) return 7.8;
    if (hay.includes("28")) return 12.5;
  }
  if (/\btrv\b/.test(hay)) return 18;
  if (hay.includes("lockshield")) return 9;
  if (hay.includes("isolation valve")) return 9;
  if (hay.includes("automatic air vent") || /\baav\b/.test(hay)) return 9.5;
  if (hay.includes("drain cock") || hay.includes("drain-off")) return 6.5;
  if (hay.includes("pipe clip") || hay.includes("saddle")) return 0.45;
  if (hay.includes("zone valve") || hay.includes("2-port")) return 55;
  if (hay.includes("wiring centre")) return 42;
  if (hay.includes("filling loop")) return 28;
  if (hay.includes("bypass")) return 48;
  if (hay.includes("prv") || hay.includes("relief")) return 22;
  if (hay.includes("tundish") || hay.includes("g3")) return 42;
  if (hay.includes("actuator")) return 22;
  return 0;
}

function tag(
  line: KitLine,
  unitCost: number,
  pricingSource: KitPricingSource,
  pricingNote?: string,
): KitLine {
  return { ...line, unitCost, pricingSource, pricingNote };
}

/** Fill £0 kit lines with keyword soft guides (safe for client bundles). */
export function applySoftGuidePricesToKit(lines: KitLine[]): KitLine[] {
  return lines.map((line) => {
    if (line.unitCost > 0) {
      return line.pricingSource
        ? line
        : tag(line, line.unitCost, line.pricingSource || "rule", line.pricingNote);
    }
    const unit = line.unit || "nr";
    const guide = softGuide(line.description, unit);
    if (guide > 0) {
      return tag(
        line,
        guide,
        "rate-library",
        "Soft guide rate — amend when supplier quote lands",
      );
    }
    return line;
  });
}
