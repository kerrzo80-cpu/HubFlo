import { getAccessProfileFromHeaders, employeeHeaderName, roleHeaderName } from "@/lib/access";

export function actorFromHeaders(headers: Headers) {
  const employeeId = headers.get(employeeHeaderName)?.trim() || "";
  const role = headers.get(roleHeaderName)?.trim() || "";
  return {
    actorId: employeeId || (role.includes("Admin") || role.includes("Office") ? "office-admin" : "field-engineer"),
    role,
    access: getAccessProfileFromHeaders(headers),
  };
}
