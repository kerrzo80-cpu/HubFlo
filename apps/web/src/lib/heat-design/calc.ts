import {
  buildKitLines,
  ceilingTypes,
  floorTypes,
  glazingTypes,
  heatPumpCatalogue,
  radiatorCatalogue,
  roomTypes,
  wallTypes,
  type RadiatorCatalogueItem,
} from "./catalogue";
import type {
  HeatDesignProject,
  HeatDesignRoom,
  HeatPumpOption,
  RoomHeatLossResult,
  SystemDesignResult,
} from "./types";

function selectedOption<T extends { id: string }>(items: readonly T[], id: string, fallbackIndex = 0) {
  return items.find((item) => item.id === id) ?? items[fallbackIndex];
}

export function numberFromInput(value: string | number | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isDecimalDraft(value: string) {
  return /^(\d+)?([.,]\d*)?$/.test(value);
}

export function exteriorWallAreaForRoom(room: HeatDesignRoom) {
  const length = numberFromInput(room.length);
  const width = numberFromInput(room.width);
  const height = numberFromInput(room.height);
  const longSide = Math.max(length, width);
  const shortSide = Math.min(length, width);
  const exteriorLength =
    room.exteriorWalls <= 0
      ? 0
      : room.exteriorWalls === 1
        ? longSide
        : room.exteriorWalls === 2
          ? longSide + shortSide
          : room.exteriorWalls === 3
            ? longSide + shortSide * 2
            : (length + width) * 2;

  return Math.max(0, exteriorLength * height);
}

export function calculateRoomHeatLoss(room: HeatDesignRoom, designExternalTemp = -3): RoomHeatLossResult {
  const roomType = selectedOption(roomTypes, room.roomType);
  const wallType = selectedOption(wallTypes, room.wallType);
  const glazingType = selectedOption(glazingTypes, room.glazingType);
  const floorType = selectedOption(floorTypes, room.floorType);
  const ceilingType = selectedOption(ceilingTypes, room.ceilingType);

  const length = numberFromInput(room.length);
  const width = numberFromInput(room.width);
  const height = numberFromInput(room.height);
  const windowArea = room.glazingType === "No External Windows Or Doors" ? 0 : numberFromInput(room.windowArea);
  const floorArea = Math.max(0, length * width);
  const volume = floorArea * Math.max(0, height);
  const targetTemp = roomType?.targetTemp ?? 21;
  const externalDelta = Math.max(0, targetTemp - designExternalTemp);
  const exteriorWallArea = exteriorWallAreaForRoom(room);
  const glazingArea = Math.min(Math.max(0, windowArea), exteriorWallArea || windowArea);
  const opaqueWallArea = Math.max(0, exteriorWallArea - Math.min(glazingArea, exteriorWallArea));

  const wallLoss = opaqueWallArea * (wallType?.uValue ?? 1.47) * externalDelta;
  const glazingLoss = glazingArea * (glazingType?.uValue ?? 2.9) * externalDelta;
  const floorLoss =
    floorArea * (floorType?.uValue ?? 0.82) * Math.max(0, targetTemp - (floorType?.adjacentTemp ?? designExternalTemp));
  const ceilingLoss =
    floorArea * (ceilingType?.uValue ?? 0.71) * Math.max(0, targetTemp - (ceilingType?.adjacentTemp ?? designExternalTemp));
  const airChanges = roomType?.airChanges ?? 0.5;
  const ventilationLoss = 0.33 * airChanges * volume * externalDelta;

  const baseWatts = wallLoss + glazingLoss + floorLoss + ceilingLoss + ventilationLoss;
  const watts = Math.round(baseWatts);
  const meanWaterTemperature = numberFromInput(room.meanWaterTemperature, 45);
  const deltaT = Math.max(1, meanWaterTemperature - targetTemp);
  const correctionFactor = Math.max(0.25, Math.pow(deltaT / 50, 1.3));
  const radiatorOutputAtDeltaT50 = Math.round(watts / correctionFactor);

  return {
    watts,
    btu: Math.round(baseWatts * 3.412),
    radiatorOutputAtDeltaT50,
    deltaT,
    wallLoss,
    glazingLoss,
    floorLoss,
    ceilingLoss,
    ventilationLoss,
    targetTemp,
    volume,
    floorArea,
  };
}

export function recommendedRadiatorsForRoom(
  room: HeatDesignRoom,
  designExternalTemp = -3,
  limit = 6,
): RadiatorCatalogueItem[] {
  const heatLoss = calculateRoomHeatLoss(room, designExternalTemp);
  const preferred =
    room.preferredRange === "Any range"
      ? [...radiatorCatalogue]
      : radiatorCatalogue.filter((radiator) => radiator.range === room.preferredRange);
  const candidates = preferred.length ? preferred : [...radiatorCatalogue];
  const suitable = [...candidates]
    .filter((radiator) => radiator.outputWatts >= heatLoss.radiatorOutputAtDeltaT50)
    .sort((a, b) => a.outputWatts - b.outputWatts);
  return (suitable.length ? suitable : [...candidates].sort((a, b) => b.outputWatts - a.outputWatts)).slice(0, limit);
}

export function pickRadiatorForRoom(room: HeatDesignRoom, designExternalTemp = -3) {
  const options = recommendedRadiatorsForRoom(room, designExternalTemp);
  const selected = room.selectedRadiatorId
    ? radiatorCatalogue.find((radiator) => radiator.id === room.selectedRadiatorId)
    : null;
  return selected ?? options[0] ?? null;
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

function scopAtFlow(pump: HeatPumpOption, flowTemp: number) {
  if (flowTemp <= 35) return pump.scopAt35;
  if (flowTemp >= 55) return pump.scopAt55;
  if (flowTemp <= 45) {
    const t = (flowTemp - 35) / 10;
    return pump.scopAt35 + (pump.scopAt45 - pump.scopAt35) * t;
  }
  const t = (flowTemp - 45) / 10;
  return pump.scopAt45 + (pump.scopAt55 - pump.scopAt45) * t;
}

export function suggestHeatPump(designLoadKw: number, flowTemp: number): HeatPumpOption {
  const ranked = [...heatPumpCatalogue]
    .map((pump) => ({ pump, capacity: capacityAtFlow(pump, flowTemp) }))
    .filter((row) => row.capacity >= designLoadKw * 0.95)
    .sort((a, b) => a.capacity - b.capacity);
  return ranked[0]?.pump ?? heatPumpCatalogue[heatPumpCatalogue.length - 1]!;
}

/** Simplified outdoor sound fall-off for planning-style check. */
export function assessSoundDb(soundPowerDb: number, distanceM: number) {
  const distance = Math.max(1, distanceM);
  return Math.round(soundPowerDb - 20 * Math.log10(distance) - 8);
}

export function calculateSystemDesign(project: HeatDesignProject): SystemDesignResult {
  const roomResults = project.rooms.map((room) => ({
    room,
    loss: calculateRoomHeatLoss(
      { ...room, meanWaterTemperature: String(project.flowTemperature) },
      project.designExternalTemp,
    ),
  }));
  const totalHeatLossW = roomResults.reduce((sum, row) => sum + row.loss.watts, 0);
  const totalHeatLossKw = totalHeatLossW / 1000;

  const dailyHotWaterLitres = project.dailyHotWaterLitres || Math.max(80, project.occupants * 50);
  const cylinderLitres = project.cylinderLitres || 210;
  // Energy to raise cylinder 40K (approx) — 1.16 Wh/L·K
  const dhwDailyKwh = (dailyHotWaterLitres * 40 * 1.16) / 1000;
  const dhwPeakKw = Math.min(6, cylinderLitres / 70);

  const designLoadKw = totalHeatLossKw + dhwPeakKw * 0.2;

  const selectedPump =
    heatPumpCatalogue.find((pump) => pump.id === project.selectedHeatPumpId) ??
    suggestHeatPump(designLoadKw, project.flowTemperature);

  const capacityAtFlowKw = capacityAtFlow(selectedPump, project.flowTemperature);
  const scop = scopAtFlow(selectedPump, project.flowTemperature);
  const coveragePercent = designLoadKw > 0 ? Math.min(200, (capacityAtFlowKw / designLoadKw) * 100) : 0;

  const estimatedAnnualHeatKwh = Math.max(project.currentAnnualKwh * 0.85, totalHeatLossKw * 1800) + dhwDailyKwh * 365;
  const estimatedHpElectricityKwh = scop > 0 ? estimatedAnnualHeatKwh / scop : 0;
  const estimatedHpCost = estimatedHpElectricityKwh * project.electricityUnitRate;
  const fuelRate =
    project.currentFuel === "Electric"
      ? project.electricityUnitRate
      : project.currentFuel === "Oil"
        ? 0.09
        : project.currentFuel === "LPG"
          ? 0.1
          : project.gasUnitRate;
  const estimatedCurrentCost = project.currentAnnualKwh * fuelRate;
  const estimatedAnnualSaving = estimatedCurrentCost - estimatedHpCost;
  const co2Factor =
    project.currentFuel === "Electric" ? 0.2 : project.currentFuel === "Oil" ? 0.27 : project.currentFuel === "LPG" ? 0.23 : 0.2;
  const co2SavingKg = Math.max(0, project.currentAnnualKwh * co2Factor - estimatedHpElectricityKwh * 0.15);

  let emitterUpgradeCount = 0;
  for (const row of roomResults) {
    const rad = pickRadiatorForRoom(
      { ...row.room, meanWaterTemperature: String(project.flowTemperature) },
      project.designExternalTemp,
    );
    if (!rad || rad.outputWatts < row.loss.radiatorOutputAtDeltaT50) emitterUpgradeCount += 1;
    else {
      const k1Like = radiatorCatalogue.find((item) => item.model.startsWith("K1"));
      if (k1Like && row.loss.radiatorOutputAtDeltaT50 > k1Like.outputWatts) emitterUpgradeCount += 1;
    }
  }

  const soundAssessmentDb = assessSoundDb(
    selectedPump.soundPowerDb,
    project.nearestNeighbourDistanceM || project.outdoorUnitDistanceM || 3,
  );

  const kit = buildKitLines({
    pump: selectedPump,
    cylinderLitres,
    flowTemperature: project.flowTemperature,
    emitterUpgradeCount,
    extras: project.kitExtras ?? [],
  });
  const kitTotal = kit.reduce((sum, line) => sum + line.qty * line.unitCost, 0);

  return {
    totalHeatLossW,
    totalHeatLossKw,
    dhwPeakKw,
    dhwDailyKwh,
    designLoadKw,
    selectedPump,
    capacityAtFlowKw,
    scop,
    coveragePercent,
    estimatedAnnualHeatKwh,
    estimatedHpElectricityKwh,
    estimatedHpCost,
    estimatedCurrentCost,
    estimatedAnnualSaving,
    co2SavingKg,
    emitterUpgradeCount,
    soundOk: soundAssessmentDb <= 42,
    soundAssessmentDb,
    kit,
    kitTotal,
  };
}

export function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
}

export function kw(value: number, digits = 1) {
  return `${value.toFixed(digits)} kW`;
}

export function wattsLabel(value: number) {
  return `${Math.round(value).toLocaleString("en-GB")} W`;
}

/** Migrate older localStorage projects missing plan / kit fields. */
export function normaliseProject(project: HeatDesignProject): HeatDesignProject {
  return {
    ...project,
    cylinderLitres: project.cylinderLitres || 210,
    dailyHotWaterLitres: project.dailyHotWaterLitres || Math.max(80, (project.occupants || 3) * 50),
    outdoorUnitDistanceM: project.outdoorUnitDistanceM || 3,
    nearestNeighbourDistanceM: project.nearestNeighbourDistanceM || 8,
    kitExtras: project.kitExtras ?? [],
    rooms: (project.rooms ?? []).map((room, index) => ({
      ...room,
      planX: typeof room.planX === "number" ? room.planX : (index % 3) * 4.5,
      planY: typeof room.planY === "number" ? room.planY : Math.floor(index / 3) * 4,
    })),
  };
}
