/** Browser helper — posts takeoff habits to `/api/takeoff-learning` (fire-and-forget). */

export type TakeoffLearningClientEvent = {
  type: "ai_confirm" | "ai_reject" | "manual_linear" | "scale_choice" | "pipe_spec_choice";
  projectId?: string;
  codes?: string[];
  rejectedCodes?: string[];
  pipeSpecId?: string;
  classificationId?: string;
  scaleLabel?: string;
  trade?: string;
};

export function recordTakeoffLearningClient(event: TakeoffLearningClientEvent): void {
  if (typeof window === "undefined") return;
  void fetch("/api/takeoff-learning", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {
    // Learning must never block mark-up.
  });
}
