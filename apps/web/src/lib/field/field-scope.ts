import { employeeHeaderName, parseRole, roleHeaderName } from "@/lib/access";
import { engineerIdForName } from "@/lib/engineer-data";

const SUPERVISORY_ROLES = new Set(["Owner/Admin", "Manager", "Office"]);
const authUserNameHeader = "x-nexa-auth-user-name";

/**
 * Resolve which engineer the caller is allowed to act as for Field endpoints.
 *
 * - Authenticated non-supervisors are locked to their OWN engineer identity
 *   (derived from their name), so they can only see/submit their own diary.
 * - Supervisors (Owner/Admin, Manager, Office) may target a specific engineer
 *   via the requested id (e.g. office reviewing an engineer's hours).
 * - With no authenticated session (pilot/open dev mode) the previous behaviour
 *   is preserved so local development keeps working.
 *
 * The engineer schedule/time-check stores key on the name-derived `eng-*` id,
 * so we map the authenticated user's name through the same helper. If it cannot
 * be resolved the caller is scoped to a non-matching id, which the stores treat
 * as "no jobs" (fail closed) rather than leaking every engineer's data.
 */
export function resolveFieldEngineerId(headers: Headers, requestedEngineerId?: string): string | undefined {
  const authName = headers.get(authUserNameHeader)?.trim() || "";
  const authEmployeeId = headers.get(employeeHeaderName)?.trim() || "";
  const role = parseRole(headers.get(roleHeaderName));
  const requested = requestedEngineerId?.trim() || "";
  const authenticated = Boolean(authEmployeeId || authName);

  if (!authenticated) {
    return requested || undefined;
  }

  // Supervisors (office/managers/admins) may review a chosen engineer, or the
  // whole team when none is specified.
  if (role && SUPERVISORY_ROLES.has(role)) {
    return requested || undefined;
  }

  // Engineers (and any other role) are locked to their own diary.
  return authName ? engineerIdForName(authName) : authEmployeeId;
}

export function isSupervisoryRequest(headers: Headers): boolean {
  const role = parseRole(headers.get(roleHeaderName));
  return Boolean(role && SUPERVISORY_ROLES.has(role));
}
