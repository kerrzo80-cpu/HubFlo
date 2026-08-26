/**
 * Shared pipe size / material helpers (no heavy layout or calc imports).
 */

import type { HeatingPipeDiameterMm, HeatingPipeKind } from "./types";

export type HeatingPipeSizeTier = {
  diameterMm: HeatingPipeDiameterMm;
  pipeSpecId: string;
  material: string;
};

/** True for underfloor circuit pipe (loops + manifold tails) — not plant primary F&R. */
export function isUfhCircuitPipe(pipe: {
  label?: string;
  material?: string;
  pipeSpecId?: string;
}): boolean {
  const label = pipe.label || "";
  if (/ufh\s*(loop|tail)/i.test(label)) return true;
  const mat = (pipe.material || "").toLowerCase();
  if (mat === "pex" || mat === "pe-rt" || mat === "mlcp" || mat === "ufh pipe") return true;
  const spec = (pipe.pipeSpecId || "").toLowerCase();
  return spec === "pex-16" || spec === "ufh-16";
}

/** Blake size policy: mains 28 · branches 22 · rad tails 15 · UFH loops/tails 16 PEX. */
export function sizeTierForPipe(kind: HeatingPipeKind, label: string): HeatingPipeSizeTier {
  const text = `${kind} ${label}`.toLowerCase();
  // UK underfloor: continuous 16 mm PEX from manifold through the room loop.
  if (/ufh\s*(loop|tail)/i.test(label) || /ufh loop|ufh tail/.test(text)) {
    return { diameterMm: 16, pipeSpecId: "pex-16", material: "PEX" };
  }
  if (kind === "primary" || kind === "refrigerant") {
    return { diameterMm: 28, pipeSpecId: "cu-28", material: "Copper" };
  }
  if (kind === "gas" || kind === "oil") {
    return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
  }
  if (kind === "dhw") {
    return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
  }
  // Flow/return: tails to emitters are 15; anything labelled branch/spine/main steps up.
  if (/\b(main|spine|branch|riser)\b/.test(text)) {
    return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
  }
  if (kind === "flow" || kind === "return") {
    return { diameterMm: 15, pipeSpecId: "cu-15", material: "Copper" };
  }
  return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
}
