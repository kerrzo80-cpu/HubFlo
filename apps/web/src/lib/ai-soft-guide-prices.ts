/**
 * Client-safe soft guide prices — no SQLite / server store.
 * Full rate-library matching stays in ai-guide-prices.ts (server only).
 */

import type { KitLine, KitPricingSource } from "@/lib/heat-design/types";
import { normalizeDescriptionForRateLookup } from "@/lib/takeoff-rate-core";

/** Keep soft-guide client-safe — do not import tender-boq-blake-prices (pulls OpenAI). */
function normaliseUnit(unit: string): string {
  const raw = (unit || "nr").trim().toLowerCase().replace(/\./g, "");
  if (!raw) return "nr";
  if (["item", "ite", "sum", "ls", "lump", "lumpsum", "no", "nos", "each", "ea", "nr", "n", "1"].includes(raw)) {
    return "nr";
  }
  if (["lm", "linm", "lin m", "mtr", "metre", "meter", "linmetre", "linmeter", "m", "run", "rnm"].includes(raw)) {
    return "m";
  }
  if (raw === "m2" || raw === "sqm" || raw === "m²" || raw === "sq m" || raw === "squaremetre") return "m2";
  return raw;
}

function softGuide(description: string, unit: string): number {
  const hay = normalizeDescriptionForRateLookup(description).toLowerCase();
  const normalisedUnit = normaliseUnit(unit);
  if (normalisedUnit === "m" || normalisedUnit === "lm" || normalisedUnit === "run") {
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
  if (normalisedUnit === "m2") {
    if (hay.includes("insulation") || hay.includes("mineral wool") || hay.includes("quilt")) return 4.5;
  }
  // Commercial sanitary / brassware / wastes (Health Club style BoQs)
  if (hay.includes("linear") && (hay.includes("grid") || hay.includes("drain") || hay.includes("channel"))) return 185;
  if (hay.includes("shower tray waste") || (hay.includes("high flow") && hay.includes("waste"))) return 42;
  if (hay.includes("shower tray") || hay.includes("shower base")) return 220;
  if (hay.includes("bedding") || hay.includes("silicone") || hay.includes("sealing all round") || hay.includes("plugging")) {
    return 8.5;
  }
  if (hay.includes("brushed brass") || hay.includes("brassware") || hay.includes("brass tap")) return 95;
  if (hay.includes("mixer tap") || hay.includes("basin mixer") || hay.includes("tap set")) return 85;
  if (hay.includes("urinal")) return 145;
  if (hay.includes("doc m") || (hay.includes("disabled") && hay.includes("pack"))) return 420;
  if (hay.includes("grab rail") || hay.includes("handrail")) return 28;
  if (hay.includes("mirror")) return 45;
  if (hay.includes("soap dispenser") || hay.includes("paper towel") || hay.includes("toilet roll")) return 35;
  if (hay.includes("vanity") || hay.includes("countertop basin")) return 185;
  if (hay.includes("concealed cistern") || hay.includes("geberit")) return 165;
  if (hay.includes("flush plate") || hay.includes("flush panel")) return 55;
  if (hay.includes("bottle trap") || hay.includes("slot waste") || hay.includes("basin waste")) return 12;
  if (hay.includes("shower valve") || hay.includes("thermostatic shower") || hay.includes("shower mixer")) return 195;
  if (hay.includes("shower head") || hay.includes("handset") || hay.includes("riser rail")) return 65;
  if (hay.includes("pipe boxing") || hay.includes("duct panel") || hay.includes("access panel")) return 45;
  if (hay.includes("fire collar") || hay.includes("intumescent") || hay.includes("fire sleeve")) return 18;
  if (hay.includes("lagging") || hay.includes("armaflex") || hay.includes("pipe insulation")) return 1.85;

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
  if (hay.includes("builders work") || hay.includes("chase") || hay.includes("make good") || hay.includes("pipe sleeve")) {
    return 35;
  }
  if (hay.includes("towel rail")) return 85;
  if (/\bwc\b/.test(hay) || hay.includes("toilet")) return 185;
  if (hay.includes("basin") || /\bwhb\b/.test(hay)) return 95;
  if (hay.includes("bath")) return 220;
  if (hay.includes("shower")) return 160;
  if (hay.includes("radiator") || hay.includes("panel rad")) return 95;
  if (hay.includes("sink")) return 110;
  if (hay.includes("boiler") || hay.includes("combi")) return 1450;
  if (hay.includes("cylinder") || hay.includes("unvented")) return 780;
  if (hay.includes("pump") && !hay.includes("condensate")) return 95;
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
