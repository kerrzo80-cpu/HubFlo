import { assistantReadCapabilities } from "./assistant-read-capabilities";
import { coreCapabilities } from "./capabilities";
import { chatWriteCapabilities } from "./chat-write-capabilities";
import { humanEntityCapabilities } from "./human-entity-capabilities";
import { jobDirectoryCapabilities } from "./job-directory-capability";
import { jobUpdateCapabilities } from "./job-update-capabilities";
import { knowledgeCapabilities } from "./knowledge-capabilities";
import { operatorCapabilities } from "./operator-capabilities";
import { createBlakeCapabilityRegistry } from "./registry";

export * from "./context-store";
export * from "./types";
export { createBlakeCapabilityRegistry } from "./registry";
export { assistantReadCapabilities } from "./assistant-read-capabilities";
export { coreCapabilities } from "./capabilities";
export { chatWriteCapabilities } from "./chat-write-capabilities";
export { humanEntityCapabilities } from "./human-entity-capabilities";
export { jobDirectoryCapabilities } from "./job-directory-capability";
export { jobUpdateCapabilities } from "./job-update-capabilities";
export { knowledgeCapabilities } from "./knowledge-capabilities";
export { operatorCapabilities } from "./operator-capabilities";

const humanResolutionCapabilityNames = new Set([
  "search_nexa_records",
  "check_schedule_availability",
  "list_invoices",
]);

const nonHumanCoreCapabilities = coreCapabilities.filter(
  (capability) => !humanResolutionCapabilityNames.has(capability.definition.name),
);

export const blakeCore = createBlakeCapabilityRegistry([
  ...nonHumanCoreCapabilities,
  ...jobDirectoryCapabilities,
  ...assistantReadCapabilities,
  // Human-facing entity operations have one authoritative registration path.
  // This prevents an older exact-string implementation reappearing if registry
  // ordering changes later.
  ...humanEntityCapabilities,
  ...knowledgeCapabilities,
  ...chatWriteCapabilities,
  ...operatorCapabilities,
  ...jobUpdateCapabilities,
]);
