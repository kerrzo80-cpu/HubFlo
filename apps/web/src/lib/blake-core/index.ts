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

export const blakeCore = createBlakeCapabilityRegistry([
  ...coreCapabilities,
  ...jobDirectoryCapabilities,
  ...assistantReadCapabilities,
  // These deliberately come after the older generic read capabilities so the
  // registry exposes the human-friendly v2 search/get implementations.
  ...humanEntityCapabilities,
  ...knowledgeCapabilities,
  ...chatWriteCapabilities,
  ...operatorCapabilities,
  ...jobUpdateCapabilities,
]);
