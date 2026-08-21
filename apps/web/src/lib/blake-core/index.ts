import { coreCapabilities } from "./capabilities";
import { operatorCapabilities } from "./operator-capabilities";
import { createBlakeCapabilityRegistry } from "./registry";

export * from "./context-store";
export * from "./types";
export { createBlakeCapabilityRegistry } from "./registry";
export { coreCapabilities } from "./capabilities";
export { operatorCapabilities } from "./operator-capabilities";

export const blakeCore = createBlakeCapabilityRegistry([
  ...coreCapabilities,
  ...operatorCapabilities,
]);
