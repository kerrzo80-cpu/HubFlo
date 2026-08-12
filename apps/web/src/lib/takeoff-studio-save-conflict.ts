/** Detect stale takeoff PATCH when another session already saved the same project. */

export function takeoffStudioSaveConflicts(
  serverUpdatedAt: string | undefined,
  expectedUpdatedAt: string | undefined,
): boolean {
  return Boolean(expectedUpdatedAt && serverUpdatedAt && serverUpdatedAt !== expectedUpdatedAt);
}
