/**
 * Production / live-workspace security helpers.
 * Prefer fail-closed for webhooks and secrets when NeXa is in users/live mode.
 */

export function isUserAuthMode() {
  return process.env.NEXA_AUTH_MODE?.trim().toLowerCase() === "users";
}

export function isLiveWorkspace() {
  return process.env.NEXA_WORKSPACE_MODE?.trim().toLowerCase() === "live";
}

/** Strict mode: production-like deployments must not fail-open on missing secrets. */
export function isStrictSecurityMode() {
  if (isUserAuthMode() || isLiveWorkspace()) return true;
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  return nodeEnv === "production";
}

/** True when OpenAI (and similar) keys must come from env / secret manager, not SQLite. */
export function requireEnvSecretsOnly() {
  return isStrictSecurityMode();
}

export function integrationBearerAuthorized(request: Request, envName = "HUBFLO_INTEGRATION_TOKEN") {
  const expected = process.env[envName]?.trim();
  if (!expected) {
    if (isStrictSecurityMode()) return false;
    return true;
  }
  return request.headers.get("authorization") === `Bearer ${expected}`;
}
