export type NexaWorkspaceMode = "demo" | "live";

export function getWorkspaceMode(env: NodeJS.ProcessEnv = process.env): NexaWorkspaceMode {
  const mode = env.NEXA_WORKSPACE_MODE?.trim().toLowerCase();
  return mode === "live" || mode === "trial" ? "live" : "demo";
}

export function useDemoSeedData(env: NodeJS.ProcessEnv = process.env) {
  return getWorkspaceMode(env) === "demo";
}

export function publicAppUrl(env: NodeJS.ProcessEnv = process.env) {
  return env.NEXT_PUBLIC_APP_URL?.trim() || "";
}

/**
 * Friend-trial Render instance only. Never nexa-live or nexa-pilot,
 * even if NEXA_TRIAL=1 is set by mistake.
 */
export function isTrialInstance(env: NodeJS.ProcessEnv = process.env) {
  if (env.NEXA_TRIAL?.trim() !== "1") return false;
  const url = publicAppUrl(env);
  if (/nexa-live/i.test(url) || /nexa-pilot/i.test(url)) return false;
  return true;
}

/** Owner reset / boot wipe. Requires live mode on the trial instance. */
export function isTrialCompanyResetAllowed(env: NodeJS.ProcessEnv = process.env) {
  if (/nexa-live/i.test(publicAppUrl(env))) return false;
  if (!isTrialInstance(env)) return false;
  return getWorkspaceMode(env) === "live";
}

export function trialCompanyName(env: NodeJS.ProcessEnv = process.env) {
  return env.NEXA_COMPANY_NAME?.trim() || "Trial company";
}
