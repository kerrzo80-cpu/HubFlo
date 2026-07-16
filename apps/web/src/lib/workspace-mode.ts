export type NexaWorkspaceMode = "demo" | "live";

export function getWorkspaceMode(): NexaWorkspaceMode {
  return process.env.NEXA_WORKSPACE_MODE?.trim().toLowerCase() === "live" ? "live" : "demo";
}

export function useDemoSeedData() {
  return getWorkspaceMode() === "demo";
}
