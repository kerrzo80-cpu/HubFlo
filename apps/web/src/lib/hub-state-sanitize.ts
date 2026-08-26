import type { HubDetailState } from "@/lib/hub-detail-store";
import { stripDayworkBlobsForPoll } from "@/lib/daywork-poll-strip";

/**
 * Strip secrets and credentials from hub-state before sending to the browser.
 * Passwords must never round-trip through /api/hub-state.
 */
export function sanitizeHubStateForClient(state: HubDetailState): HubDetailState {
  const stripped = stripDayworkBlobsForPoll(state);
  const employees = Array.isArray(stripped.employees)
    ? stripped.employees.map((row) => {
        if (!row || typeof row !== "object") return row;
        const employee = row as Record<string, unknown>;
        const login = employee.login;
        if (!login || typeof login !== "object" || Array.isArray(login)) {
          return employee;
        }
        const loginRecord = login as Record<string, unknown>;
        return {
          ...employee,
          login: {
            ...loginRecord,
            password: "",
            hasPassword: Boolean(
              typeof loginRecord.password === "string" && loginRecord.password.trim(),
            ),
          },
        };
      })
    : stripped.employees;

  const integrationSettings = stripped.integrationSettings
    && typeof stripped.integrationSettings === "object"
    && !Array.isArray(stripped.integrationSettings)
    ? sanitizeIntegrationSettings(stripped.integrationSettings as Record<string, unknown>)
    : stripped.integrationSettings;

  return {
    ...stripped,
    employees: employees as HubDetailState["employees"],
    integrationSettings,
  };
}

function sanitizeIntegrationSettings(settings: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...settings };
  for (const key of Object.keys(next)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("password")
      || lower.includes("secret")
      || lower.includes("token")
      || lower.includes("apikey")
      || lower.includes("api_key")
    ) {
      const value = next[key];
      next[key] = typeof value === "string" && value.trim() ? "[redacted]" : value;
    }
  }
  return next;
}
