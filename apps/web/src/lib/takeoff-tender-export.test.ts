import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultStudioState, type StudioState } from "./takeoff-studio.ts";
import {
  TAKEOFF_BOQ_SHEET_PREFIX,
  buildTakeoffTenderBoqLines,
  isTakeoffBoqLine,
  mergeTakeoffBoqLines,
  takeoffBoqSheetName,
} from "./takeoff-tender-export.ts";

function studioWithTwoLayers(): StudioState {
  const base = createDefaultStudioState();
  const hotCls = base.classifications.find((row) => row.id === "cls-ai-P-PIPE-C");
  const heatCls = base.classifications.find((row) => row.id === "cls-linear-heating-flow");
  assert.ok(hotCls);
  assert.ok(heatCls);
  return {
    ...base,
    scales: [
      {
        id: "scale-1",
        documentId: "doc-1",
        page: 1,
        metresPerUnit: 0.01,
        label: "1:100",
      },
    ],
    geometries: [
      {
        id: "geo-cold",
        kind: "linear",
        classificationId: hotCls.id,
        documentId: "doc-1",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        material: "Copper",
        diameter: "15mm",
      },
      {
        id: "geo-heat",
        kind: "linear",
        classificationId: heatCls.id,
        documentId: "doc-1",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
        material: "Copper",
        diameter: "22mm",
      },
      {
        id: "geo-rad",
        kind: "count",
        classificationId: "cls-count-trv",
        documentId: "doc-1",
        page: 1,
        point: { x: 10, y: 10 },
      },
    ],
  };
}

test("takeoffBoqSheetName prefixes Draw-as layer labels", () => {
  assert.equal(takeoffBoqSheetName("Hot & cold"), `${TAKEOFF_BOQ_SHEET_PREFIX}Hot & cold`);
  assert.equal(takeoffBoqSheetName(`${TAKEOFF_BOQ_SHEET_PREFIX}Heating`), `${TAKEOFF_BOQ_SHEET_PREFIX}Heating`);
});

test("buildTakeoffTenderBoqLines splits sheets by service layer", () => {
  const lines = buildTakeoffTenderBoqLines(studioWithTwoLayers(), { projectRef: "TK-100" });
  const sheets = [...new Set(lines.map((line) => line.sheet).filter(Boolean))];
  assert.ok(sheets.includes(`${TAKEOFF_BOQ_SHEET_PREFIX}Hot & cold`));
  assert.ok(sheets.includes(`${TAKEOFF_BOQ_SHEET_PREFIX}Heating`));
  assert.ok(lines.some((line) => line.kind === "measured" && line.sheet?.includes("Hot & cold")));
  assert.ok(lines.some((line) => line.kind === "measured" && line.sheet?.includes("Heating")));
  assert.ok(lines.every((line) => isTakeoffBoqLine(line)));
});

test("mergeTakeoffBoqLines replaces prior Takeoff sheets only", () => {
  const existing = [
    {
      id: "other-1",
      kind: "measured" as const,
      description: "Existing electrical",
      quantity: 1,
      unit: "nr",
      rate: 50,
      value: 50,
      sheet: "Electrical",
    },
    {
      id: "takeoff-boq-old",
      kind: "measured" as const,
      description: "Old takeoff",
      quantity: 1,
      unit: "nr",
      rate: 10,
      value: 10,
      sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}Hot & cold`,
      section: "Pipework",
    },
  ];
  const next = buildTakeoffTenderBoqLines(studioWithTwoLayers());
  const merged = mergeTakeoffBoqLines(existing, next);
  assert.equal(merged.some((line) => line.id === "other-1"), true);
  assert.equal(merged.some((line) => line.id === "takeoff-boq-old"), false);
  assert.ok(merged.some((line) => line.id.startsWith("takeoff-boq-") && line.kind === "measured"));
});

test("buildTakeoffTenderBoqLines groups quantities by floor from drawing names", () => {
  const base = studioWithTwoLayers();
  const hotClsId = base.geometries.find((geo) => geo.kind === "linear")!.classificationId;
  const studio: StudioState = {
    ...base,
    scales: [
      {
        documentId: "doc-ground",
        page: 1,
        metresPerUnit: 0.01,
        label: "1:100",
      },
      {
        documentId: "doc-first",
        page: 1,
        metresPerUnit: 0.01,
        label: "1:100",
      },
    ],
    geometries: [
      {
        id: "geo-ground",
        kind: "linear",
        classificationId: hotClsId,
        documentId: "doc-ground",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        material: "Copper",
        diameter: "15mm",
      },
      {
        id: "geo-first",
        kind: "linear",
        classificationId: hotClsId,
        documentId: "doc-first",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
        material: "Copper",
        diameter: "15mm",
      },
    ],
  };

  const lines = buildTakeoffTenderBoqLines(studio, {
    documents: [
      { id: "doc-ground", fileName: "Ground floor - gas.pdf" },
      { id: "doc-first", fileName: "First floor - gas.pdf" },
    ],
  });
  assert.ok(lines.some((line) => line.kind === "header" && line.description === "Ground"));
  assert.ok(lines.some((line) => line.kind === "header" && line.description === "First"));
  assert.ok(lines.some((line) => line.kind === "measured" && (line.note || "").includes("Ground")));
  assert.ok(lines.some((line) => line.kind === "measured" && (line.note || "").includes("First")));
});

test("buildTakeoffTenderBoqLines uses house-type tabs when folder notes exist", () => {
  const base = studioWithTwoLayers();
  const hotClsId = base.geometries.find((geo) => geo.kind === "linear")!.classificationId;
  const heatClsId = base.geometries.find((geo) => geo.id === "geo-heat")!.classificationId;
  const studio: StudioState = {
    ...base,
    scales: [
      { documentId: "doc-belerno", page: 1, metresPerUnit: 0.01, label: "1:100" },
      { documentId: "doc-bell", page: 1, metresPerUnit: 0.01, label: "1:100" },
    ],
    geometries: [
      {
        id: "geo-bel-hot",
        kind: "linear",
        classificationId: hotClsId,
        documentId: "doc-belerno",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        material: "Copper",
        diameter: "15mm",
      },
      {
        id: "geo-bel-heat",
        kind: "linear",
        classificationId: heatClsId,
        documentId: "doc-belerno",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
        ],
        material: "Copper",
        diameter: "22mm",
      },
      {
        id: "geo-bell-hot",
        kind: "linear",
        classificationId: hotClsId,
        documentId: "doc-bell",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
        material: "Copper",
        diameter: "15mm",
      },
    ],
  };

  const lines = buildTakeoffTenderBoqLines(studio, {
    documents: [
      { id: "doc-belerno", fileName: "Belerno GF.pdf", notes: ["sourceFolder:Belerno"] },
      { id: "doc-bell", fileName: "Bell GF.pdf", notes: ["sourceFolder:Bell"] },
    ],
  });
  const sheets = [...new Set(lines.map((line) => line.sheet).filter(Boolean))];
  assert.ok(sheets.includes(`${TAKEOFF_BOQ_SHEET_PREFIX}Belerno`));
  assert.ok(sheets.includes(`${TAKEOFF_BOQ_SHEET_PREFIX}Bell`));
  assert.equal(sheets.some((sheet) => sheet?.includes("Hot & cold")), false);

  const belernoMeasured = lines.filter(
    (line) => line.kind === "measured" && line.sheet === `${TAKEOFF_BOQ_SHEET_PREFIX}Belerno`,
  );
  const bellMeasured = lines.filter(
    (line) => line.kind === "measured" && line.sheet === `${TAKEOFF_BOQ_SHEET_PREFIX}Bell`,
  );
  assert.ok(belernoMeasured.length >= 2);
  assert.equal(bellMeasured.length, 1);
  assert.ok(lines.some((line) => line.kind === "header" && line.description === "Hot & cold" && line.sheet?.includes("Belerno")));
  assert.ok(lines.some((line) => line.kind === "header" && line.description === "Heating" && line.sheet?.includes("Belerno")));
});
