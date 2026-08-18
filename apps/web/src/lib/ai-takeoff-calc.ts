/**
 * NeXa-controlled calculation engine for AI Takeoff proposals.
 * The model must not invent money totals — only quantities / descriptions.
 */

import {
  DEFAULT_AI_TAKEOFF_PRICING_RULES,
  type AiTakeoffLine,
  type AiTakeoffPricingRules,
  type CalculatedTakeoffLine,
} from "@/lib/ai-takeoff-assistant-types";

export function roundLabourHours(hours: number, step = 0.5): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  const s = step > 0 ? step : 0.5;
  return Math.round(hours / s) * s;
}

export function calculateTakeoffLine(
  line: AiTakeoffLine,
  rules: AiTakeoffPricingRules = DEFAULT_AI_TAKEOFF_PRICING_RULES,
): CalculatedTakeoffLine {
  const qty = Number.isFinite(line.quantity) ? Math.max(0, line.quantity) : 0;
  const unitCost = Number.isFinite(line.unitCost) ? Math.max(0, line.unitCost) : 0;
  const markup = Number.isFinite(line.markupPercent) ? line.markupPercent : rules.materialsMarkupPercent;
  const labourHours = roundLabourHours(
    Number.isFinite(line.labourHours) ? line.labourHours : 0,
    rules.labourRoundToHours,
  );
  const labourRate = Number.isFinite(line.labourRate) && line.labourRate > 0
    ? line.labourRate
    : rules.labourRatePerHour;

  const materialCost = qty * unitCost;
  const materialSell = materialCost * (1 + markup / 100);
  const labourCost = labourHours * labourRate;
  const labourSell = labourCost; // labour already charged at sell rate in EWG rules
  const lineTotalCost = materialCost + labourCost;
  const lineTotalSell = materialSell + labourSell;

  return {
    ...line,
    quantity: qty,
    unitCost,
    markupPercent: markup,
    labourHours,
    labourRate,
    materialSell: roundMoney(materialSell),
    labourCost: roundMoney(labourCost),
    labourSell: roundMoney(labourSell),
    lineTotalCost: roundMoney(lineTotalCost),
    lineTotalSell: roundMoney(lineTotalSell),
  };
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function calculateHouseTypeTotal(
  lines: AiTakeoffLine[],
  houseType: string,
  rules?: AiTakeoffPricingRules,
) {
  const rows = lines
    .filter((line) => line.status !== "rejected")
    .filter((line) => !houseType || line.houseType === houseType)
    .map((line) => calculateTakeoffLine(line, rules));
  return {
    houseType,
    lineCount: rows.length,
    totalCost: roundMoney(rows.reduce((sum, row) => sum + row.lineTotalCost, 0)),
    totalSell: roundMoney(rows.reduce((sum, row) => sum + row.lineTotalSell, 0)),
    labourHours: roundMoney(rows.reduce((sum, row) => sum + row.labourHours, 0)),
  };
}

export function calculateProjectTotals(
  lines: AiTakeoffLine[],
  plots: Array<{ plot: string; houseType: string }>,
  rules?: AiTakeoffPricingRules,
  vatRatePercent = 20,
) {
  const houseTypes = Array.from(new Set(plots.map((p) => p.houseType).filter(Boolean)));
  const perHouse = houseTypes.map((houseType) => calculateHouseTypeTotal(lines, houseType, rules));
  const byHouse = Object.fromEntries(perHouse.map((row) => [row.houseType, row]));

  let projectSell = 0;
  let projectCost = 0;
  let projectHours = 0;
  for (const plot of plots) {
    const house = byHouse[plot.houseType];
    if (!house) continue;
    projectSell += house.totalSell;
    projectCost += house.totalCost;
    projectHours += house.labourHours;
  }

  // Lines without house type still count once at project level
  const orphan = lines
    .filter((line) => line.status !== "rejected" && !line.houseType)
    .map((line) => calculateTakeoffLine(line, rules));
  projectSell += orphan.reduce((sum, row) => sum + row.lineTotalSell, 0);
  projectCost += orphan.reduce((sum, row) => sum + row.lineTotalCost, 0);
  projectHours += orphan.reduce((sum, row) => sum + row.labourHours, 0);

  const vat = roundMoney(projectSell * (vatRatePercent / 100));
  return {
    houseTypes: perHouse,
    plotCount: plots.length,
    totalCost: roundMoney(projectCost),
    totalSell: roundMoney(projectSell),
    vat,
    grandTotal: roundMoney(projectSell + vat),
    labourHours: roundMoney(projectHours),
  };
}

export function findDuplicateTakeoffLines(lines: AiTakeoffLine[]): string[] {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const line of lines) {
    if (line.status === "rejected" || line.kind === "header" || line.kind === "note") continue;
    const key = [
      line.houseType || "",
      line.plotNumber || "",
      line.costCentre || "",
      line.ref || "",
      line.description.trim().toLowerCase(),
      line.unit || "",
    ].join("|");
    const prior = seen.get(key);
    if (prior) dupes.push(`${line.id} duplicates ${prior}`);
    else seen.set(key, line.id);
  }
  return dupes;
}

export function validatePlotRegister(
  plots: Array<{ plot: string; houseType: string }>,
  houseTypes: string[],
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of plots) {
    const plot = String(row.plot || "").trim();
    if (!plot) {
      errors.push("Blank plot number in register.");
      continue;
    }
    if (seen.has(plot)) errors.push(`Duplicate plot ${plot}.`);
    seen.add(plot);
    if (row.houseType && houseTypes.length && !houseTypes.includes(row.houseType)) {
      errors.push(`Plot ${plot} uses unknown house type “${row.houseType}”.`);
    }
  }
  // Only require every area/house type to have plots when a plot register is in use
  // (multi-plot housing). Single-area commercial jobs may have areas without a plot schedule.
  if (plots.length > 0) {
    for (const houseType of houseTypes) {
      if (!plots.some((plot) => plot.houseType === houseType)) {
        errors.push(`House type “${houseType}” has no plots assigned.`);
      }
    }
  }
  return errors;
}
