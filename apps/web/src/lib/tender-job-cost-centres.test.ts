import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { TAKEOFF_BOQ_SHEET_PREFIX } from "./takeoff-tender-export";
import {
  buildJobStructureFromTenderBoq,
  healJobCostCentresShape,
} from "./tender-job-cost-centres";
import type { TenderBoqLine } from "./tenders-types";

test("buildJobStructureFromTenderBoq maps floors to sections and services to cost centres", () => {
  const lines: TenderBoqLine[] = [
    {
      id: "h-lg",
      kind: "header",
      description: "Lower ground",
      sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}Hot & cold`,
      section: "Lower ground",
    },
    {
      id: "m-lg-pipe",
      kind: "measured",
      ref: "PIPE",
      description: "15mm cold pipe",
      quantity: 10,
      unit: "m",
      rate: 12,
      value: 120,
      note: "Lower ground · Rate library",
      sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}Hot & cold`,
      section: "Pipework",
    },
    {
      id: "h-gnd-heat",
      kind: "header",
      description: "Ground",
      sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}Heating`,
      section: "Ground",
    },
    {
      id: "m-gnd-rad",
      kind: "measured",
      ref: "CNT",
      description: "Radiator",
      quantity: 2,
      unit: "nr",
      rate: 250,
      value: 500,
      note: "Ground · Rate library",
      sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}Heating`,
      section: "Counts",
    },
    {
      id: "m-ww",
      kind: "measured",
      description: "Boiler pack",
      quantity: 1,
      unit: "nr",
      rate: 4000,
      value: 4000,
      sheet: "Ground Floor Heating",
      section: "Heating",
    },
  ];

  const structure = buildJobStructureFromTenderBoq(
    { id: "job-1", ref: "J-9001", description: "Queens Terrace" },
    lines,
  );

  assert.deepEqual(
    structure.sections.map((section) => section.name),
    ["Lower ground", "Ground"],
  );
  assert.equal(structure.costCentres.length, 2);
  assert.equal(structure.totalSell, 4620);

  const hotCold = structure.costCentres.find((centre) => centre.name === "Hot & cold");
  const heating = structure.costCentres.find((centre) => centre.name === "Heating");
  assert.ok(hotCold);
  assert.ok(heating);
  assert.equal(hotCold?.materials.length, 1);
  assert.equal(heating?.materials.length, 2);

  const centreSell = structure.costCentres.reduce(
    (sum, centre) =>
      sum +
      centre.materials.reduce((inner, line) => inner + line.quantity * line.unitCost, 0),
    0,
  );
  assert.equal(Math.round(centreSell * 100) / 100, structure.totalSell);
});

test("applyTenderBoqStructureToJob writes hub sections/centres and syncs job value", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-tender-cc-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", { invoices: [], jobCostCentres: {}, jobSections: {} });
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  const { createJob } = await import("./workflow-data");
  const { applyTenderBoqStructureToJob } = await import("./tender-job-cost-centres");
  const { getHubDetailState } = await import("./hub-detail-store");

  const job = createJob({
    customer: "Matt",
    site: "3 Queens",
    description: "Heating",
    manager: "Office",
    status: "Pending",
    value: 1,
    next: "Schedule",
    due: "2026-08-13",
  });

  const applied = applyTenderBoqStructureToJob(job, [
    {
      id: "l1",
      kind: "measured",
      description: "Cylinder",
      quantity: 1,
      rate: 1800,
      value: 1800,
      note: "First · guide",
      sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}Hot & cold`,
      section: "Pipework",
    },
    {
      id: "l2",
      kind: "measured",
      description: "Radiator",
      quantity: 3,
      rate: 200,
      value: 600,
      note: "First · guide",
      sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}Heating`,
      section: "Counts",
    },
  ]);

  assert.equal(applied.totalSell, 2400);
  assert.equal(applied.job.value, 2400);
  assert.equal(applied.sections[0]?.name, "First");
  assert.equal(applied.costCentres.length, 2);

  const hub = getHubDetailState();
  const centres = (hub.jobCostCentres as Record<string, unknown[]>)?.[job.id];
  const sections = (hub.jobSections as Record<string, unknown[]>)?.[job.id];
  assert.equal(centres?.length, 2);
  assert.equal(sections?.length, 1);
});

test("healJobCostCentresShape collapses oversized material dumps", () => {
  const materials = Array.from({ length: 450 }, (_, index) => ({
    id: `m-${index}`,
    catalogItemId: "tender-boq",
    description: `Line ${index}`,
    quantity: 1,
    unitCost: 10,
    markupPercent: 0,
  }));
  const healed = healJobCostCentresShape("job-big", [
    {
      id: "cc-1",
      name: "Heating",
      sectionId: "sec-1",
      clientDescription: "Heating",
      engineerDescription: "BoQ",
      materials,
      labour: undefined as unknown as [],
    },
  ]);
  assert.equal(healed.healed, true);
  assert.equal(healed.centres[0]?.materials.length, 1);
  assert.equal(healed.centres[0]?.materials[0]?.unitCost, 4500);
  assert.ok(Array.isArray(healed.centres[0]?.labour));
});

test("buildJobStructureFromTenderBoq caps materials per cost centre", () => {
  const lines: TenderBoqLine[] = Array.from({ length: 60 }, (_, index) => ({
    id: `l-${index}`,
    kind: "measured" as const,
    description: `Pipe ${index}`,
    quantity: 1,
    rate: 5,
    value: 5,
    note: "Ground · guide",
    sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}Heating`,
    section: "Pipework",
  }));
  const structure = buildJobStructureFromTenderBoq(
    { id: "job-cap", ref: "J-CAP", description: "Cap test" },
    lines,
  );
  assert.ok(structure.costCentres[0]);
  assert.ok(structure.costCentres[0]!.materials.length <= 40);
  assert.equal(structure.totalSell, 300);
});
