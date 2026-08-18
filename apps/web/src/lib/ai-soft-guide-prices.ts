/**
 * Client-safe soft guide prices — no SQLite / server store.
 * Full rate-library matching stays in ai-guide-prices.ts (server only).
 */

import type { KitLine, KitPricingSource } from "@/lib/heat-design/types";
import { normalizeDescriptionForRateLookup } from "@/lib/takeoff-rate-core";

function softGuide(description: string, unit: string): number {
  const hay = normalizeDescriptionForRateLookup(description).toLowerCase();
  if (unit === "m" || unit === "lm" || unit === "run") {
    if (hay.includes("insulation") || hay.includes("lagging") || hay.includes("armaflex")) return 1.85;
    if (/\b2\.5\b/.test(hay) && (hay.includes("t&e") || hay.includes("cable") || hay.includes("twin"))) return 1.15;
    if (/\b1\.5\b/.test(hay) && (hay.includes("t&e") || hay.includes("cable") || hay.includes("twin"))) return 0.85;
    if (hay.includes("100mm") && hay.includes("duct")) return 4.8;
    if (hay.includes("110") && (hay.includes("ug") || hay.includes("drain") || hay.includes("foul"))) return 12;
    if (hay.includes("110") && (hay.includes("soil") || hay.includes("s&v"))) return 9.5;
    if (hay.includes("mdpe") || hay.includes("blue poly")) {
      if (hay.includes("32")) return 3.1;
      return 2.4;
    }
    if (hay.includes("15")) return 4.2;
    if (hay.includes("22")) return 7.8;
    if (hay.includes("28")) return 12.5;
    if (hay.includes("waste") && hay.includes("32")) return 2.8;
    if (hay.includes("waste") && hay.includes("40")) return 3.6;
    if (hay.includes("waste") && hay.includes("50")) return 5.2;
  }
  if (unit === "m2") {
    if (hay.includes("insulation") || hay.includes("mineral wool") || hay.includes("quilt")) return 4.5;
  }
  if (/\btrv\b/.test(hay)) return 18;
  if (hay.includes("lockshield")) return 9;
  if (hay.includes("isolation valve") || hay.includes("isolating valve") || hay.includes("isovalve")) return 9;
  if (hay.includes("stopcock") || hay.includes("stop cock") || hay.includes("stop valve")) return 14;
  if (hay.includes("automatic air vent") || /\baav\b/.test(hay)) return 9.5;
  if (hay.includes("drain cock") || hay.includes("drain-off") || hay.includes("drain off")) return 6.5;
  if (hay.includes("pipe clip") || hay.includes("saddle")) return 0.45;
  if (hay.includes("zone valve") || hay.includes("2-port") || hay.includes("2 port")) return 55;
  if (hay.includes("wiring centre") || hay.includes("wiring center")) return 42;
  if (hay.includes("filling loop")) return 28;
  if (hay.includes("bypass")) return 48;
  if (hay.includes("prv") || hay.includes("relief")) return 22;
  if (hay.includes("tundish") || hay.includes("g3")) return 42;
  if (hay.includes("actuator")) return 22;
  if (hay.includes("flexi") || hay.includes("braided hose")) return 4.5;
  if (/\btee\b/.test(hay)) return 2.4;
  if (hay.includes("gully")) return 28;
  if (hay.includes("inspection chamber") || hay.includes("manhole")) return 95;
  if (hay.includes("air admittance") || /\bavt\b/.test(hay) || hay.includes("vent terminal")) return 18;
  if (hay.includes("rodding eye")) return 12;
  if (hay.includes("double socket") || hay.includes("socket outlet") || hay.includes("13a socket")) return 4.5;
  if (hay.includes("light switch") || hay.includes("gang switch")) return 3.2;
  if (hay.includes("downlight") || hay.includes("downlighter")) return 12;
  if (hay.includes("consumer unit") || hay.includes("distribution board")) return 145;
  if (/\bfcu\b/.test(hay) || hay.includes("fused spur")) return 8.5;
  if (hay.includes("extract fan") || hay.includes("exhaust fan") || hay.includes("bathroom fan")) return 65;
  if (/\bmvhr\b/.test(hay) || hay.includes("heat recovery")) return 1850;
  if (hay.includes("fire collar") || hay.includes("intumescent") || hay.includes("fire sleeve")) return 18;
  if (hay.includes("builders work") || hay.includes("chase") || hay.includes("make good") || hay.includes("pipe sleeve")) {
    return 35;
  }
  if (hay.includes("towel rail")) return 85;
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

/** Soft budget material £ for a description/unit — used by Blake takeoff import. */
export function softGuideUnitCost(description: string, unit: string): number {
  return softGuide(description, unit || "nr");
}
