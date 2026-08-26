/** Detect stale takeoff PATCH when another session already saved the same project.
 * Callers should prefer per-drawing merge (see takeoff-studio-concurrent-merge) over a hard 409
 * when the body includes studio + touchedDocumentIds.
 */

export function takeoffStudioSaveConflicts(
  serverUpdatedAt: string | undefined,
  expectedUpdatedAt: string | undefined,
): boolean {
  return Boolean(expectedUpdatedAt && serverUpdatedAt && serverUpdatedAt !== expectedUpdatedAt);
}
