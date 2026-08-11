import { applySoftGuidePricesToKit } from "@/lib/ai-soft-guide-prices";

import {
  buildKitLines,
  ceilingTypes,
  defaultExteriorFlags,
  floorTypes,
  glazingTypes,
  heatPumpCatalogue,
  radiatorCatalogue,
  roomTypes,
  wallConstructions,
  wallTypes,
  type RadiatorCatalogueItem,
} from "./catalogue";
import { buildBlakeAncillariesKit } from "./blake-kit";
import { numberFromInput } from "./calc-number";
import {
  exteriorPerimeter,
  polygonArea,
  rectPolygon,
  roomPolygon,
  roomWallExterior,
  syncRoomFromPolygon,
} from "./geometry";
import { isUfhCircuitPipe } from "./pipe-sizing";
import { heatingSystemOptions } from "./systems";
import type {
  HeatDesignProject,
  HeatDesignRevision,
  HeatDesignRoom,
  HeatPumpOption,
  RoomHeatLossResult,
  SystemDesignResult,
} from "./types";

export { numberFromInput, isDecimalDraft } from "./calc-number";

function selectedOption<T extends { id: string }>(items: readonly T[], id: string, fallbackIndex = 0) {
  return items.find((item) => item.id === id) ?? items[fallbackIndex];
}

export function exteriorWallAreaForRoom(room: HeatDesignRoom) {
  const height = numberFromInput(room.height, 2.4);
  const polygon = roomPolygon(room);
  const exterior = roomWallExterior(room, polygon.length);
  const perimeter = exteriorPerimeter(polygon, exterior);
  if (perimeter > 0) return perimeter * height;

  // Legacy rectangular fallback
  const length = numberFromInput(room.length);
  const width = numberFromInput(room.width);
  const flags = room.exteriorFlags ?? [
    room.exteriorWalls > 0,
    room.exteriorWalls > 1,
    room.exteriorWalls > 2,
    room.exteriorWalls > 3,
  ];
  const segments = [length, width, length, width];
  let exteriorLength = 0;
  for (let i = 0; i < 4; i += 1) {
    if (flags[i]) exteriorLength += segments[i]!;
  }
  return Math.max(0, exteriorLength * height);
}

export function calculateRoomHeatLoss(
  room: HeatDesignRoom,
  designExternalTemp = -3,
  wallUValueOverride?: number,
): RoomHeatLossResult {
  const roomType = selectedOption(roomTypes, room.roomType);
  const wallType = selectedOption(wallTypes, room.wallType);
  const glazingType = selectedOption(glazingTypes, room.glazingType);
  const floorType = selectedOption(floorTypes, room.floorType);
  const ceilingType = selectedOption(ceilingTypes, room.ceilingType);

  const polygon = roomPolygon(room);
  const height = numberFromInput(room.height, 2.4);
  const openings = room.openings ?? [];
  let openingArea = 0;
  let openingGlazingLoss = 0;
  const targetTemp =
    typeof room.targetTemp === "number" && Number.isFinite(room.targetTemp)
      ? room.targetTemp
      : (roomType?.targetTemp ?? 21);
  const externalDelta = Math.max(0, targetTemp - designExternalTemp);

  for (const opening of openings) {
    const area = Math.max(0, opening.widthM * opening.heightM);
    openingArea += area;
    const material =
      selectedOption(glazingTypes, opening.materialId || room.glazingType) ?? glazingType;
    openingGlazingLoss += area * (material?.uValue ?? 2.9) * externalDelta;
  }

  const windowArea =
    room.glazingType === "No External Windows Or Doors"
      ? 0
      : openingArea > 0
        ? openingArea
        : numberFromInput(room.windowArea);
  const floorArea = Math.max(0, polygonArea(polygon) || numberFromInput(room.length) * numberFromInput(room.width));
  const volume = floorArea * Math.max(0, height);
  const exteriorWallArea = exteriorWallAreaForRoom(room);
  const glazingArea = Math.min(Math.max(0, windowArea), exteriorWallArea || windowArea);
  const opaqueWallArea = Math.max(0, exteriorWallArea - Math.min(glazingArea, exteriorWallArea));
  const wallU = wallUValueOverride ?? wallType?.uValue ?? 1.47;

  const wallLoss = opaqueWallArea * wallU * externalDelta;
  const glazingLoss =
    openingArea > 0
      ? openingGlazingLoss
      : glazingArea * (glazingType?.uValue ?? 2.9) * externalDelta;
  const floorLoss =
    floorArea * (floorType?.uValue ?? 0.82) * Math.max(0, targetTemp - (floorType?.adjacentTemp ?? designExternalTemp));
  const ceilingLoss =
    floorArea * (ceilingType?.uValue ?? 0.71) * Math.max(0, targetTemp - (ceilingType?.adjacentTemp ?? designExternalTemp));
  const airChanges =
    typeof room.airChanges === "number" && Number.isFinite(room.airChanges)
      ? Math.max(0, room.airChanges)
      : (roomType?.airChanges ?? 0.5);
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

export function assessSoundDb(soundPowerDb: number, distanceM: number) {
  const distance = Math.max(1, distanceM);
  return Math.round(soundPowerDb - 20 * Math.log10(distance) - 8);
}

export function calculateSystemDesign(project: HeatDesignProject): SystemDesignResult {
  const primaryWall = wallConstructions.find((item) => item.id === project.primaryWallConstructionId);
  const wallU = primaryWall?.uValue;
  const roomResults = project.rooms.map((room) => ({
    room,
    loss: calculateRoomHeatLoss(
      { ...room, meanWaterTemperature: String(project.flowTemperature) },
      project.designExternalTemp,
      wallU,
    ),
  }));
  const totalHeatLossW = roomResults.reduce((sum, row) => sum + row.loss.watts, 0);
  const totalHeatLossKw = totalHeatLossW / 1000;
  const totalFloorArea = roomResults.reduce((sum, row) => sum + row.loss.floorArea, 0);
  const totalExteriorWallArea = project.rooms.reduce((sum, room) => sum + exteriorWallAreaForRoom(room), 0);
  const openingCount = project.rooms.reduce((sum, room) => sum + (room.openings?.length ?? 0), 0);

  const dailyHotWaterLitres = project.dailyHotWaterLitres || Math.max(80, project.occupants * 50);
  const cylinderLitres = project.cylinderLitres || 210;
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
  const radiatorLines: Array<{ description: string; qty: number; unitCost: number }> = [];
  for (const row of roomResults) {
    const rad = pickRadiatorForRoom(
      { ...row.room, meanWaterTemperature: String(project.flowTemperature) },
      project.designExternalTemp,
    );
    if (!rad || rad.outputWatts < row.loss.radiatorOutputAtDeltaT50) emitterUpgradeCount += 1;
    if (rad) {
      radiatorLines.push({
        description: `${row.room.name}: ${rad.range} ${rad.model} (${rad.outputWatts} W)`,
        qty: 1,
        unitCost: rad.costRate,
      });
    } else {
      emitterUpgradeCount += 1;
    }
  }

  const soundAssessmentDb = assessSoundDb(
    selectedPump.soundPowerDb,
    project.nearestNeighbourDistanceM || project.outdoorUnitDistanceM || 3,
  );

  const materialsNotes: string[] = [];
  if (!project.primaryWallConstructionId) materialsNotes.push("Pick a primary external wall construction.");
  if ((project.selectedRadiatorTypeIds?.length ?? 0) === 0) materialsNotes.push("Select allowed radiator types.");
  if (project.rooms.length === 0) materialsNotes.push("Add rooms on the floor plan.");
  if (openingCount === 0) materialsNotes.push("Add windows/doors on walls for glazing takeoff.");

  const chosenSystem =
    heatingSystemOptions.find((item) => item.id === project.chosenSystemId) ??
    heatingSystemOptions.find((item) => item.id === "opt-ashp");
  const systemKind = chosenSystem?.kind ?? "ashp";

  const emitterMode = project.emitterMode ?? project.heatingLayout?.emitterMode ?? "radiators";
  const layoutPipes = project.heatingLayout?.pipes ?? [];
  let ufhLoopRunM = 0;
  let copperPipeRunM = 0;
  for (const pipe of layoutPipes) {
    let len = 0;
    for (let i = 1; i < pipe.points.length; i += 1) {
      const a = pipe.points[i - 1]!;
      const b = pipe.points[i]!;
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (isUfhCircuitPipe(pipe)) ufhLoopRunM += len;
    else copperPipeRunM += len;
  }
  const measuredCopperM = copperPipeRunM;
  const baseKit = buildKitLines({
    systemKind,
    systemLabel: chosenSystem?.label,
    pump: systemKind === "ashp" || systemKind === "hybrid" ? selectedPump : null,
    cylinderLitres,
    flowTemperature: project.flowTemperature,
    emitterUpgradeCount,
    extras: project.kitExtras ?? [],
    floorAreaM2: totalFloorArea,
    exteriorWallAreaM2: totalExteriorWallArea,
    openingCount,
    pipeRunM: Math.round(
      measuredCopperM > 1 ? measuredCopperM : totalFloorArea * 1.15 + project.rooms.length * 4,
    ),
    ufhLoopRunM: Math.round(ufhLoopRunM),
    wallConstructionLabel: primaryWall ? `${primaryWall.label} (U=${primaryWall.uValue})` : undefined,
    radiatorLines,
    emitterMode,
    designLoadKw,
  });
  // Soft guides only here — full rate-library / OpenAI budget pricing is server-side
  // (blake-budget-prices). Do not import SQLite-backed modules into this client path.
  const blakeKit = applySoftGuidePricesToKit(
    project.blakeProposal?.kitLines?.length
      ? project.blakeProposal.kitLines
      : buildBlakeAncillariesKit({
          systemKind,
          emitterMode,
          layout: project.heatingLayout,
          roomCount: project.rooms.length,
          floorAreaM2: totalFloorArea,
        }),
  );
  const kit = [...baseKit, ...blakeKit];
  const kitTotal = kit.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
  const materialsComplete =
    materialsNotes.length === 0 &&
    Boolean(project.primaryWallConstructionId) &&
    (project.selectedRadiatorTypeIds?.length ?? 0) > 0 &&
    project.rooms.length > 0;

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
    materialsComplete,
    materialsNotes,
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

function normaliseRevisions(revisions: HeatDesignProject["revisions"]): HeatDesignRevision[] {
  if (!Array.isArray(revisions)) return [];
  return revisions
    .filter((revision): revision is HeatDesignRevision => {
      return (
        revision != null &&
        typeof revision.id === "string" &&
        revision.id.trim().length > 0 &&
        typeof revision.at === "string" &&
        revision.at.trim().length > 0 &&
        typeof revision.summary === "string" &&
        revision.summary.trim().length > 0
      );
    })
    .map((revision) => ({
      id: revision.id.trim(),
      at: revision.at.trim(),
      actor: typeof revision.actor === "string" && revision.actor.trim() ? revision.actor.trim() : undefined,
      summary: revision.summary.trim(),
      snapshotHash:
        typeof revision.snapshotHash === "string" && revision.snapshotHash.trim()
          ? revision.snapshotHash.trim()
          : undefined,
    }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50);
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
    blakeProposal: project.blakeProposal ?? null,
    activeFloor: project.activeFloor ?? "ground",
    selectedWallConstructionIds: project.selectedWallConstructionIds ?? ["cav-mw-100-wp"],
    primaryWallConstructionId: project.primaryWallConstructionId ?? "cav-mw-100-wp",
    selectedRadiatorTypeIds: project.selectedRadiatorTypeIds ?? ["rad-k1", "rad-k2", "rad-k3"],
    reportOptionIds:
      project.reportOptionIds?.length
        ? project.reportOptionIds
        : ["opt-ashp", "opt-gas", "opt-oil"],
    chosenSystemId: project.chosenSystemId,
    emitterMode: project.emitterMode ?? project.heatingLayout?.emitterMode ?? "radiators",
    planUnderlay: project.planUnderlay ?? null,
    linkedJobId: project.linkedJobId,
    linkedJobRef: project.linkedJobRef,
    linkedQuoteId: project.linkedQuoteId,
    linkedQuoteRef: project.linkedQuoteRef,
    heatingLayout: project.heatingLayout
      ? {
          ...project.heatingLayout,
          emitters: project.heatingLayout.emitters ?? [],
          emitterMode:
            project.heatingLayout.emitterMode ?? project.emitterMode ?? "radiators",
        }
      : null,
    revisions: normaliseRevisions(project.revisions),
    rooms: (project.rooms ?? []).map((room, index) => {
      const exteriorFlags = room.exteriorFlags ?? defaultExteriorFlags(room.exteriorWalls ?? 2);
      const polygon =
        room.polygon && room.polygon.length >= 3
          ? room.polygon
          : rectPolygon(
              typeof room.planX === "number" ? room.planX : (index % 3) * 4.5,
              typeof room.planY === "number" ? room.planY : Math.floor(index / 3) * 4,
              numberFromInput(room.length, 3.5),
              numberFromInput(room.width, 3.2),
            );
      const openings = (room.openings ?? []).map((opening) => ({
        ...opening,
        wallIndex: opening.wallIndex ?? opening.wall ?? 0,
      }));
      return syncRoomFromPolygon(
        {
          ...room,
          exteriorFlags,
          floorLevel: room.floorLevel ?? "ground",
          openings,
          wallExterior: room.wallExterior ?? Array.from({ length: polygon.length }, (_, i) => exteriorFlags[i] ?? true),
        },
        polygon,
      );
    }),
  };
}
