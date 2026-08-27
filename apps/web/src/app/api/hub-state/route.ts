import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { ensureGasCertTrialInCore } from "@/lib/gas-cert-trial-core";
import { reconcileDayworkVariationsFromEvidence } from "@/lib/engineer-flow";
import { getHubDetailState, saveHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { mergeHubDetailState } from "@/lib/hub-state-merge";
import { sanitizeHubStateForClient } from "@/lib/hub-state-sanitize";
import { parseJsonRequestBody } from "@/lib/http";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.showQuotes && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  ensureGasCertTrialInCore();
  try {
    reconcileDayworkVariationsFromEvidence();
  } catch {
    // Best-effort backfill of Daywork variation cards from Field evidence.
  }
  // Poll responses omit base64 signatures and employee passwords.
  return NextResponse.json(sanitizeHubStateForClient(getHubDetailState()));
}

export async function PUT(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.canCreateQuote && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<HubDetailState>(request);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const current = getHubDetailState();
  // Never let a client wipe passwords by posting redacted hub-state back.
  const safePayload = restoreEmployeePasswordsFromCurrent(current, payload);
  const merged = mergeHubDetailState(current, safePayload);
  saveHubDetailState(merged);
  try {
    reconcileDayworkVariationsFromEvidence();
  } catch {
    // Best-effort: rebuild Daywork variation cards if Core omitted them.
  }
  return NextResponse.json(sanitizeHubStateForClient(getHubDetailState()));
}

function restoreEmployeePasswordsFromCurrent(current: HubDetailState, payload: HubDetailState): HubDetailState {
  if (!Array.isArray(payload.employees) || !Array.isArray(current.employees)) return payload;
  const currentById = new Map<string, Record<string, unknown>>();
  for (const row of current.employees) {
    if (!row || typeof row !== "object") continue;
    const employee = row as Record<string, unknown>;
    const id = typeof employee.id === "string" ? employee.id : "";
    if (id) currentById.set(id, employee);
  }

  const employees = payload.employees.map((row) => {
    if (!row || typeof row !== "object") return row;
    const employee = { ...(row as Record<string, unknown>) };
    const id = typeof employee.id === "string" ? employee.id : "";
    const existing = id ? currentById.get(id) : undefined;
    const login = employee.login;
    if (!login || typeof login !== "object" || Array.isArray(login)) return employee;
    const loginRecord = { ...(login as Record<string, unknown>) };
    const incomingPassword = typeof loginRecord.password === "string" ? loginRecord.password : "";
    if (incomingPassword.trim()) return employee;
    const existingLogin = existing?.login;
    if (existingLogin && typeof existingLogin === "object" && !Array.isArray(existingLogin)) {
      const existingPassword = (existingLogin as Record<string, unknown>).password;
      if (typeof existingPassword === "string" && existingPassword.trim()) {
        loginRecord.password = existingPassword;
        employee.login = loginRecord;
      }
    }
    return employee;
  });

  return { ...payload, employees: employees as HubDetailState["employees"] };
}
