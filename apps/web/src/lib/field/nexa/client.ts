import type { NexaFieldClient, UpdateTimeLineInput } from "@/lib/field/types";
import { normalizeCoreTimeCheck } from "@/lib/field/nexa/from-core";
import {
  getMockJob,
  getMockSchedule,
  getMockScheduleDates,
  getMockTimeCheck,
  MOCK_ENGINEER,
  submitMockTimeCheck,
  updateMockTimeLine,
} from "@/lib/field/nexa/mock-data";

/**
 * Local field client. Used when Field runs standalone without Core APIs.
 */
export function createMockNexaClient(): NexaFieldClient {
  return {
    getConnection() {
      return {
        mode: "mock",
        baseUrl: "",
        engineerId: MOCK_ENGINEER.id,
        label: "Standalone demo · multi-day diary for Chris Lawson",
      };
    },
    async getEngineer() {
      return MOCK_ENGINEER;
    },
    async getTodaySchedule() {
      return getMockSchedule();
    },
    async getScheduleForDate(date) {
      return getMockSchedule(date);
    },
    async getScheduleDates() {
      return getMockScheduleDates();
    },
    async getJob(scheduleId) {
      return getMockJob(scheduleId);
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
 * NeXa Core HTTP adapter — same-origin Field APIs backed by Core engineer data.
 */
export function createHttpNexaClient(baseUrl = "", engineerId = ""): NexaFieldClient {
  const root = baseUrl.replace(/\/$/, "");
  const engineerQuery = engineerId ? `engineerId=${encodeURIComponent(engineerId)}` : "";

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

  function withEngineer(path: string) {
    if (!engineerQuery) return path;
    return path.includes("?") ? `${path}&${engineerQuery}` : `${path}?${engineerQuery}`;
  }

  return {
    getConnection() {
      return {
        mode: "nexa",
        baseUrl: root || (typeof window !== "undefined" ? window.location.origin : ""),
        engineerId: engineerId || "core",
        label: "Connected to NeXa Core",
      };
    },
    async getEngineer() {
      return request(withEngineer("/api/field/engineer"));
    },
    async getTodaySchedule() {
      const today = new Date().toISOString().slice(0, 10);
      return request(withEngineer(`/api/field/schedule?date=${encodeURIComponent(today)}`));
    },
    async getScheduleForDate(date) {
      return request(withEngineer(`/api/field/schedule?date=${encodeURIComponent(date)}`));
    },
    async getScheduleDates() {
      return request(withEngineer("/api/field/schedule-dates"));
    },
    async getJob(scheduleId) {
      try {
        return await request(`/api/field/jobs/${encodeURIComponent(scheduleId)}`);
      } catch {
        return null;
      }
    },
    async getTimeCheck() {
      const body = await request(withEngineer("/api/field/time-check"));
      return normalizeCoreTimeCheck(body as Parameters<typeof normalizeCoreTimeCheck>[0]);
    },
    async updateTimeLine(input: UpdateTimeLineInput) {
      const body = await request("/api/field/time-check", {
        method: "POST",
        body: JSON.stringify({
          action: "update_line",
          payload: { ...input, ...(engineerId ? { engineerId } : {}) },
        }),
      });
      return normalizeCoreTimeCheck(body as Parameters<typeof normalizeCoreTimeCheck>[0]);
    },
    async submitTimeCheck(confirmRemainingAsScheduled) {
      const body = await request("/api/field/time-check", {
        method: "POST",
        body: JSON.stringify({
          action: "submit",
          payload: {
            ...(engineerId ? { engineerId } : {}),
            confirmRemainingAsScheduled: Boolean(confirmRemainingAsScheduled),
          },
        }),
      });
      return normalizeCoreTimeCheck(body as Parameters<typeof normalizeCoreTimeCheck>[0]);
    },
  };
}
