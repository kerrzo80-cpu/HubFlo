import { assistantReadCapabilities } from "./assistant-read-capabilities";
import { coreCapabilities } from "./capabilities";
import { chatWriteCapabilities } from "./chat-write-capabilities";
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
export { jobDirectoryCapabilities } from "./job-directory-capability";
export { jobUpdateCapabilities } from "./job-update-capabilities";
export { knowledgeCapabilities } from "./knowledge-capabilities";
export { operatorCapabilities } from "./operator-capabilities";

export const blakeCore = createBlakeCapabilityRegistry([
  ...coreCapabilities,
  ...jobDirectoryCapabilities,
  ...assistantReadCapabilities,
  ...knowledgeCapabilities,
  ...chatWriteCapabilities,
  ...operatorCapabilities,
  ...jobUpdateCapabilities,
]);
