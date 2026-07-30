/** Base path where Field is mounted inside @hubflo/web. */
export const FIELD_BASE = "/field";

export function fieldPath(path = ""): string {
  if (!path || path === "/") return FIELD_BASE;
  return `${FIELD_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
