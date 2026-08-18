import type { HeatDesignProject, HeatPumpOption } from "./types";
import { heatPumpCatalogue } from "./catalogue";

export type HeatingSystemKind = "ashp" | "gas" | "oil" | "lpg" | "electric" | "hybrid";

export type HeatingSystemOption = {
  id: string;
  kind: HeatingSystemKind;
  label: string;
  shortLabel: string;
  fuel: "Electricity" | "Gas" | "Oil" | "LPG" | "Mixed";
  description: string;
  /** Seasonal efficiency / SCOP used for running cost */
  efficiency: number;
  installedFrom: number;
  installedTo: number;
  co2KgPerKwh: number;
  notes: string[];
};

export type SystemOptionResult = {
  option: HeatingSystemOption;
  designLoadKw: number;
  annualHeatKwh: number;
  annualFuelKwh: number;
  annualCost: number;
  annualSavingVsCurrent: number;
  co2Kg: number;
  co2SavingVsCurrent: number;
  installedMid: number;
  paybackYears: number | null;
  coveragePercent: number;
  pump?: HeatPumpOption | null;
  rankScore: number;
  recommended: boolean;
};

export const heatingSystemOptions: HeatingSystemOption[] = [
  {
    id: "opt-ashp",
    kind: "ashp",
    label: "Air source heat pump",
    shortLabel: "ASHP",
    fuel: "Electricity",
    description: "Low-carbon electric heat pump with weather compensation and upgraded emitters where needed.",
    efficiency: 3.5,
    installedFrom: 9000,
    installedTo: 15000,
    co2KgPerKwh: 0.15,
    notes: ["Eligible for BUS grant where criteria met", "Best long-term running cost", "Needs emitter / flow-temp design"],
  },
  {
    id: "opt-gas",
    kind: "gas",
    label: "Condensing gas boiler",
    shortLabel: "Gas",
    fuel: "Gas",
    description: "Modern A-rated condensing gas boiler with controls upgrade.",
    efficiency: 0.92,
    installedFrom: 2800,
    installedTo: 4500,
    co2KgPerKwh: 0.2,
    notes: ["Familiar technology", "Lower upfront cost", "Ongoing gas price & carbon exposure"],
  },
  {
    id: "opt-oil",
    kind: "oil",
    label: "Oil-fired boiler",
    shortLabel: "Oil",
    fuel: "Oil",
    description: "Condensing oil boiler replacement for off-gas properties.",
    efficiency: 0.9,
    installedFrom: 3500,
    installedTo: 5500,
    co2KgPerKwh: 0.27,
    notes: ["Suitable where no gas main", "Fuel deliveries required", "Higher CO₂ than heat pump"],
  },
  {
    id: "opt-lpg",
    kind: "lpg",
    label: "LPG boiler",
    shortLabel: "LPG",
    fuel: "LPG",
    description: "Condensing LPG boiler for properties with LPG supply.",
    efficiency: 0.91,
    installedFrom: 3200,
    installedTo: 5000,
    co2KgPerKwh: 0.23,
    notes: ["Off-gas alternative", "Tank / bottle logistics", "Running cost typically above mains gas"],
  },
  {
    id: "opt-electric",
    kind: "electric",
    label: "Electric boiler",
    shortLabel: "Electric",
    fuel: "Electricity",
    description: "Direct electric boiler — simple install, higher running cost.",
    efficiency: 0.99,
    installedFrom: 2200,
    installedTo: 3800,
    co2KgPerKwh: 0.15,
    notes: ["Low install disruption", "Highest running cost of the set", "Consider only for small loads"],
  },
  {
    id: "opt-hybrid",
    kind: "hybrid",
    label: "Hybrid ASHP + gas",
    shortLabel: "Hybrid",
    fuel: "Mixed",
    description: "Heat pump for most of the year with gas boiler peak / backup.",
    efficiency: 2.6,
    installedFrom: 11000,
    installedTo: 17000,
    co2KgPerKwh: 0.17,
    notes: ["Good for harder-to-treat homes", "Keeps gas for peaks", "Higher install complexity"],
  },
];

function fuelUnitRate(project: HeatDesignProject, fuel: HeatingSystemOption["fuel"]) {
  if (fuel === "Electricity" || fuel === "Mixed") return project.electricityUnitRate;
  if (fuel === "Oil") return 0.09;
  if (fuel === "LPG") return 0.1;
  return project.gasUnitRate;
}

function currentFuelRate(project: HeatDesignProject) {
  return fuelUnitRate(
    project,
    project.currentFuel === "Electric" ? "Electricity" : project.currentFuel === "Gas" ? "Gas" : project.currentFuel === "Oil" ? "Oil" : "LPG",
  );
}

function currentCo2Factor(project: HeatDesignProject) {
  if (project.currentFuel === "Electric") return 0.15;
  if (project.currentFuel === "Oil") return 0.27;
  if (project.currentFuel === "LPG") return 0.23;
  return 0.2;
}

function capacityAtFlow(pump: HeatPumpOption, flowTemp: number) {
  if (flowTemp <= 35) return pump.capacityKwAt35;
  if (flowTemp >= 55) return pump.capacityKwAt55;
  if (flowTemp <= 45) {
    const t = (flowTemp - 35) / 10;
    return pump.capacityKwAt35 + (pump.capacityKwAt45 - pump.capacityKwAt35) * t;
  }
  const t = (flowTemp - 45) / 10;
  return pump.capacityKwAt45 + (pump.capacityKwAt55 - pump.capacityKwAt45) * t;
}

function suggestPump(designLoadKw: number, flowTemp: number) {
  const ranked = [...heatPumpCatalogue]
    .map((pump) => ({ pump, capacity: capacityAtFlow(pump, flowTemp) }))
    .filter((row) => row.capacity >= designLoadKw * 0.95)
    .sort((a, b) => a.capacity - b.capacity);
  return ranked[0]?.pump ?? heatPumpCatalogue[heatPumpCatalogue.length - 1]!;
}

export function compareHeatingOptions(
  project: HeatDesignProject,
  designLoadKw: number,
  annualHeatKwh: number,
  selectedOptionIds?: string[],
): SystemOptionResult[] {
  const ids = selectedOptionIds?.length ? selectedOptionIds : project.reportOptionIds ?? ["opt-ashp", "opt-gas"];
  const currentCost = project.currentAnnualKwh * currentFuelRate(project);
  const currentCo2 = project.currentAnnualKwh * currentCo2Factor(project);

  const results: SystemOptionResult[] = [];
  for (const option of heatingSystemOptions) {
    if (!ids.includes(option.id)) continue;

    let efficiency = option.efficiency;
    let pump: HeatPumpOption | null = null;
    let coveragePercent = 100;
    let installedFrom = option.installedFrom;
    let installedTo = option.installedTo;

    if (option.kind === "ashp" || option.kind === "hybrid") {
      pump =
        heatPumpCatalogue.find((item) => item.id === project.selectedHeatPumpId) ??
        suggestPump(designLoadKw, project.flowTemperature);
      efficiency =
        option.kind === "ashp"
          ? project.flowTemperature <= 35
            ? pump.scopAt35
            : project.flowTemperature >= 55
              ? pump.scopAt55
              : project.flowTemperature <= 45
                ? pump.scopAt35 + ((pump.scopAt45 - pump.scopAt35) * (project.flowTemperature - 35)) / 10
                : pump.scopAt45 + ((pump.scopAt55 - pump.scopAt45) * (project.flowTemperature - 45)) / 10
          : option.efficiency;
      const capacity = capacityAtFlow(pump, project.flowTemperature);
      coveragePercent = designLoadKw > 0 ? Math.min(200, (capacity / designLoadKw) * 100) : 0;
      installedFrom = Math.round(pump.typicalInstalledFrom * (option.kind === "hybrid" ? 1.15 : 1));
      installedTo = Math.round(installedFrom * 1.25);
    }

    const annualFuelKwh = efficiency > 0 ? annualHeatKwh / efficiency : annualHeatKwh;
    // Hybrid: assume 70% electric heat-pump path, 30% gas peak at boiler efficiency
    let annualCost = 0;
    let co2Kg = 0;
    if (option.kind === "hybrid") {
      const hpShare = annualHeatKwh * 0.7;
      const gasShare = annualHeatKwh * 0.3;
      const hpElec = hpShare / Math.max(efficiency, 1);
      const gasFuel = gasShare / 0.92;
      annualCost = hpElec * project.electricityUnitRate + gasFuel * project.gasUnitRate;
      co2Kg = hpElec * 0.15 + gasFuel * 0.2;
    } else {
      annualCost = annualFuelKwh * fuelUnitRate(project, option.fuel);
      co2Kg = annualFuelKwh * option.co2KgPerKwh;
    }

    const annualSavingVsCurrent = currentCost - annualCost;
    const co2SavingVsCurrent = currentCo2 - co2Kg;
    const installedMid = Math.round((installedFrom + installedTo) / 2);
    const paybackYears =
      annualSavingVsCurrent > 50 ? Math.round((installedMid / annualSavingVsCurrent) * 10) / 10 : null;

    // Rank: prefer lower running cost, lower CO2, sensible payback, coverage
    const rankScore =
      annualSavingVsCurrent * 2 +
      co2SavingVsCurrent * 0.05 -
      installedMid * 0.01 +
      (coveragePercent >= 95 ? 80 : coveragePercent * 0.4) +
      (option.kind === "ashp" ? 40 : 0);

    results.push({
      option: { ...option, installedFrom, installedTo, efficiency },
      designLoadKw,
      annualHeatKwh,
      annualFuelKwh,
      annualCost,
      annualSavingVsCurrent,
      co2Kg,
      co2SavingVsCurrent,
      installedMid,
      paybackYears,
      coveragePercent,
      pump,
      rankScore,
      recommended: false,
    });
  }

  results.sort((a, b) => b.rankScore - a.rankScore);
  if (results[0]) results[0].recommended = true;
  return results;
}

export const ewgCompany = {
  tradingName: "Company",
  companyName: "Company",
  address: "",
  phone: "",
  email: "",
  vatNumber: "",
  companyNumber: "",
  logoUrl: "",
  website: "",
};
