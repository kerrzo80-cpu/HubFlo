export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
    return;
  }
  const { maybeWipeTrialWorkspaceOnBoot } = await import("./lib/trial-workspace");
  maybeWipeTrialWorkspaceOnBoot();
  const { ensureTrialLicenceStartedAt } = await import("./lib/trial-licence");
  ensureTrialLicenceStartedAt();
}

export const onRequestError = async (...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  return captureRequestError(...args);
};
