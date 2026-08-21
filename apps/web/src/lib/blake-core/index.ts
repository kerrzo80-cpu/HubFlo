import { assistantReadCapabilities } from "./assistant-read-capabilities";
import { coreCapabilities } from "./capabilities";
import { jobDirectoryCapabilities } from "./job-directory-capability";
import { knowledgeCapabilities } from "./knowledge-capabilities";
import { operatorCapabilities } from "./operator-capabilities";
import { createBlakeCapabilityRegistry } from "./registry";

export * from "./context-store";
export * from "./types";
export { createBlakeCapabilityRegistry } from "./registry";
export { assistantReadCapabilities } from "./assistant-read-capabilities";
export { coreCapabilities } from "./capabilities";
export { jobDirectoryCapabilities } from "./job-directory-capability";
export { knowledgeCapabilities } from "./knowledge-capabilities";
export { operatorCapabilities } from "./operator-capabilities";

export const blakeCore = createBlakeCapabilityRegistry([
  ...coreCapabilities,
  ...jobDirectoryCapabilities,
  ...assistantReadCapabilities,
  ...knowledgeCapabilities,
  ...operatorCapabilities,
]);
