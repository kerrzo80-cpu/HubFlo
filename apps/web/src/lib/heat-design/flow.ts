import type { HeatingSystemKind } from "./systems";

export type FlowTempOption = {
  value: number;
  label: string;
};

/** Flow temperatures that suit the chosen heating system. */
export function flowTempOptionsForSystem(kind: HeatingSystemKind | undefined): FlowTempOption[] {
  if (kind === "ashp") {
    return [
      { value: 35, label: "35°C — best heat-pump efficiency" },
      { value: 40, label: "40°C" },
      { value: 45, label: "45°C — balanced ASHP" },
      { value: 50, label: "50°C" },
      { value: 55, label: "55°C — harder emitters / retrofit" },
    ];
  }
  if (kind === "hybrid") {
    return [
      { value: 40, label: "40°C — heat-pump priority" },
      { value: 45, label: "45°C — balanced hybrid" },
      { value: 50, label: "50°C" },
      { value: 55, label: "55°C" },
      { value: 60, label: "60°C — boiler assist peaks" },
      { value: 65, label: "65°C" },
    ];
  }
  // Gas / oil / LPG / electric boilers — conventional higher flow
  return [
    { value: 55, label: "55°C — condensing / lower flow" },
    { value: 60, label: "60°C" },
    { value: 65, label: "65°C" },
    { value: 70, label: "70°C — typical boiler design" },
    { value: 75, label: "75°C" },
    { value: 80, label: "80°C — older emitters / high demand" },
  ];
}

export function defaultFlowTempForSystem(kind: HeatingSystemKind | undefined): number {
  if (kind === "ashp") return 45;
  if (kind === "hybrid") return 50;
  if (kind === "electric") return 65;
  return 70;
}

export function clampFlowTempToSystem(kind: HeatingSystemKind | undefined, flowTemperature: number): number {
  const options = flowTempOptionsForSystem(kind);
  if (options.some((item) => item.value === flowTemperature)) return flowTemperature;
  // Pick nearest allowed value
  let best = options[0]!.value;
  let bestDist = Math.abs(flowTemperature - best);
  for (const option of options) {
    const dist = Math.abs(flowTemperature - option.value);
    if (dist < bestDist) {
      best = option.value;
      bestDist = dist;
    }
  }
  return best;
}
