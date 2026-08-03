/**
 * HTTP smoke test: Field Daywork save → Core GET → Core wipe PUT survival.
 * Run against a local Next server with NEXA_AUTH_MODE unset.
 *
 *   pnpm exec tsx scripts/daywork-http-smoke.ts
 */
const base = process.env.NEXA_SMOKE_BASE || "http://127.0.0.1:3456";
const headers = {
  "Content-Type": "application/json",
  "x-nexa-role": "Manager",
  "x-nexa-employee-id": "emp-brian",
  "x-nexa-permissions": "{}",
};

const sig =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(`${path} → ${response.status} ${body.error || ""}`);
  }
  return body;
}

async function main() {
  await json("/api/field/jobs/sched-gas-cert-trial/daywork", {
    method: "POST",
    body: JSON.stringify({ action: "activate" }),
  });

  const saved = await json<{
    record?: {
      materialsJson?: string;
      clientSignerName?: string;
      plumberSignature?: string;
      clientSignature?: string;
    };
  }>("/api/field/jobs/sched-gas-cert-trial/daywork", {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      createdBy: "Chris Lawson",
      record: {
        description: "Emergency leak repair on rising main",
        weekEnding: "03/08/2026",
        labourName: "Chris Lawson",
        labourTrade: "Plumber",
        labourDaysJson: JSON.stringify([{ day: "Mon", hours: "8" }]),
        labourHours: "8",
        materialsJson: JSON.stringify([
          { description: "15mm copper pipe", qty: "3" },
          { description: "Isolation valve", qty: "2" },
        ]),
        plantJson: JSON.stringify([{ description: "Pipe freezer", qty: "1" }]),
        plumberSignature: sig,
        clientSignature: sig,
        plumberSignerName: "Chris Lawson",
        clientSignerName: "Jane Client",
        completedAt: new Date().toISOString(),
        populatedFrom: "engineer-app",
      },
    }),
  });

  if (!saved.record?.materialsJson?.includes("copper") || saved.record.clientSignerName !== "Jane Client") {
    throw new Error("Field save did not return materials/client name");
  }

  const core = await json<{
    sheet?: {
      materialsJson?: string;
      clientSignerName?: string;
      plumberSignature?: string;
      clientSignature?: string;
    };
  }>("/api/jobs/job-gas-cert-trial/daywork?costCentreId=job-gas-cert-trial-daywork-account");

  if (
    !core.sheet?.materialsJson?.includes("copper") ||
    core.sheet.clientSignerName !== "Jane Client" ||
    !core.sheet.plumberSignature ||
    !core.sheet.clientSignature
  ) {
    throw new Error("Core GET missing Field materials/client/signatures");
  }

  const hub = await json<Record<string, unknown>>("/api/hub-state");
  const wiped = {
    ...hub,
    dayworkSheets: {},
    flowStepEvidence: {},
    jobDeliveryEvents: [],
    jobCostCentres: {
      "job-gas-cert-trial": (
        ((hub.jobCostCentres as Record<string, Array<{ id?: string }>> | undefined)?.[
          "job-gas-cert-trial"
        ] || []) as Array<{ id?: string }>
      ).filter((centre) => !String(centre.id || "").includes("daywork")),
    },
  };
  const afterWipe = await json<{
    dayworkSheets?: Record<string, { materialsJson?: string; clientSignerName?: string }>;
  }>("/api/hub-state", { method: "PUT", body: JSON.stringify(wiped) });

  const sheet =
    afterWipe.dayworkSheets?.["job-gas-cert-trial:job-gas-cert-trial-daywork-account"];
  if (!sheet?.materialsJson?.includes("copper") || sheet.clientSignerName !== "Jane Client") {
    throw new Error("Core wipe PUT removed Field Daywork sheet");
  }

  console.log("PASS daywork-http-smoke", {
    materials: sheet.materialsJson,
    client: sheet.clientSignerName,
  });

  // Core can also ingest a sheet without Field (office entry path).
  const coreSaved = await json<{
    persisted?: boolean;
    sheet?: { clientSignerName?: string; materialsJson?: string };
  }>("/api/jobs/job-gas-cert-trial/daywork", {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      costCentreId: "job-gas-cert-trial-daywork-account",
      createdBy: "Office",
      record: {
        description: "Core-entered daywork sheet for reactive call-out",
        weekEnding: "03-08-2026",
        labourName: "Chris Lawson",
        labourTrade: "Plumber",
        labourDaysJson: JSON.stringify([{ day: "Wed", hours: "4" }]),
        labourHours: "4",
        materialsJson: JSON.stringify([{ description: "Compression fitting", qty: "1" }]),
        plantJson: JSON.stringify([]),
        plumberSignature: sig,
        clientSignature: sig,
        plumberSignerName: "Chris Lawson",
        clientSignerName: "Office Client",
        completedAt: new Date().toISOString(),
        populatedFrom: "core",
      },
    }),
  });
  if (!coreSaved.persisted || coreSaved.sheet?.clientSignerName !== "Office Client") {
    throw new Error("Core POST did not persist Daywork sheet");
  }
  console.log("PASS daywork-core-save", { client: coreSaved.sheet?.clientSignerName });
}

main().catch((error) => {
  console.error("FAIL daywork-http-smoke", error);
  process.exit(1);
});
