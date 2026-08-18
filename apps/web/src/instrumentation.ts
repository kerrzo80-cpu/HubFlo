export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { maybeWipeTrialWorkspaceOnBoot } = await import("./lib/trial-workspace");
  maybeWipeTrialWorkspaceOnBoot();
  const { ensureTrialLicenceStartedAt } = await import("./lib/trial-licence");
  ensureTrialLicenceStartedAt();
}
