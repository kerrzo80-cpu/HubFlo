import type { NexaFieldClient } from "@/lib/types";
import {
  getMockTimeCheck,
  MOCK_ENGINEER,
  MOCK_SCHEDULE,
  submitMockTimeCheck,
  updateMockTimeLine,
} from "@/lib/nexa/mock-data";

/**
 * Local field client. Swap this for an HTTP client pointing at NeXa
 * when FIELD_NEXA_BASE_URL / connection settings are ready.
 */
export function createMockNexaClient(): NexaFieldClient {
  return {
    getConnection() {
      return {
        mode: "mock",
        baseUrl: "",
        engineerId: MOCK_ENGINEER.id,
        label: "Standalone demo (not connected to NeXa yet)",
      };
    },
    async getEngineer() {
      return MOCK_ENGINEER;
    },
    async getTodaySchedule() {
      return MOCK_SCHEDULE;
    },
    async getJob(scheduleId) {
      return MOCK_SCHEDULE.find((job) => job.scheduleId === scheduleId) ?? null;
    },
    async getTimeCheck() {
      return getMockTimeCheck();
    },
    async updateTimeLine(input) {
      return updateMockTimeLine(input);
    },
    async submitTimeCheck(confirmRemainingAsScheduled) {
      return submitMockTimeCheck(confirmRemainingAsScheduled);
    },
  };
}

/**
 * Future NeXa HTTP adapter stub.
 * Implement against /api/engineer/* once the field app is ready to connect.
 */
export function createHttpNexaClient(baseUrl: string, engineerId: string): NexaFieldClient {
  const root = baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${root}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? `NeXa request failed (${response.status})`);
    }
    return body;
  }

  return {
    getConnection() {
      return {
        mode: "nexa",
        baseUrl: root,
        engineerId,
        label: `Connected to NeXa · ${root}`,
      };
    },
    async getEngineer() {
      // Placeholder until NeXa exposes a field engineer profile endpoint.
      return {
        id: engineerId,
        name: "Field engineer",
        trade: "Field",
        phone: "",
      };
    },
    async getTodaySchedule() {
      // Will map from NeXa engineer schedule once wired.
      return request(`/api/field/schedule?engineerId=${encodeURIComponent(engineerId)}`);
    },
    async getJob(scheduleId) {
      return request(`/api/field/jobs/${encodeURIComponent(scheduleId)}`);
    },
    async getTimeCheck() {
      return request(`/api/engineer/time-check?engineerId=${encodeURIComponent(engineerId)}`);
    },
    async updateTimeLine(input) {
      return request("/api/engineer/time-check", {
        method: "POST",
        body: JSON.stringify({ action: "update_line", payload: { ...input, engineerId } }),
      });
    },
    async submitTimeCheck(confirmRemainingAsScheduled) {
      return request("/api/engineer/time-check", {
        method: "POST",
        body: JSON.stringify({
          action: "submit",
          payload: { engineerId, confirmRemainingAsScheduled: Boolean(confirmRemainingAsScheduled) },
        }),
      });
    },
  };
}
