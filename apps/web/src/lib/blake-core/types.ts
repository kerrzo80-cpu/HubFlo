import type { BlakeActor, BlakeCapabilityDefinition, BlakeCapabilityResult } from "@hubflo/domain";

import type { AccessProfile } from "@/lib/access";

export type BlakeExecutionContext = {
  actor: BlakeActor;
  access: AccessProfile;
  conversationId?: string;
  confirmed?: boolean;
};

export type BlakeCapability<Input = any, Output = any> = {
  definition: BlakeCapabilityDefinition;
  parse: (input: unknown) => Input;
  execute: (input: Input, context: BlakeExecutionContext) => Promise<Output> | Output;
};

export type BlakeRegistry = {
  definitions: () => BlakeCapabilityDefinition[];
  execute: <Output = unknown>(
    name: string,
    input: unknown,
    context: BlakeExecutionContext,
  ) => Promise<BlakeCapabilityResult<Output>>;
};
