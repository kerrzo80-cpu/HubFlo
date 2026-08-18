import assert from "node:assert/strict";
import test from "node:test";

import { withHouseTypeNote } from "./takeoff-drawing-labels.ts";
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

test("takeoffBoqSheetName prefixes house-type labels", () => {
  assert.equal(takeoffBoqSheetName("House Type A"), `${TAKEOFF_BOQ_SHEET_PREFIX}House Type A`);
  assert.equal(
    takeoffBoqSheetName(`${TAKEOFF_BOQ_SHEET_PREFIX}House Type B`),
    `${TAKEOFF_BOQ_SHEET_PREFIX}House Type B`,
  );
});

test("buildTakeoffTenderBoqLines uses one tab per house type with layer sections", () => {
  const lines = buildTakeoffTenderBoqLines(studioWithTwoLayers(), {
    projectRef: "TK-100",
    documents: [
      {
        id: "doc-1",
        fileName: "plan.pdf",
        notes: withHouseTypeNote([], "House Type A"),
      },
    ],
  });
  const sheets = [...new Set(lines.map((line) => line.sheet).filter(Boolean))];
  assert.deepEqual(sheets, [`${TAKEOFF_BOQ_SHEET_PREFIX}House Type A`]);
  assert.ok(lines.some((line) => line.kind === "header" && line.section === "Hot & cold"));
  assert.ok(lines.some((line) => line.kind === "header" && line.section === "Heating"));
  const measured = lines.filter((line) => line.kind === "measured");
  assert.ok(measured.some((line) => line.section === "Hot & cold"));
  assert.ok(measured.some((line) => line.section === "Heating"));
  assert.ok(measured.every((line) => line.section === "Hot & cold" || line.section === "Heating"));
  assert.equal(measured.some((line) => line.section === "Pipework" || line.section === "Counts"), false);
  assert.ok(lines.every((line) => isTakeoffBoqLine(line)));
});

test("heating count items including a generic valve stay in the Heating section", () => {
  const base = createDefaultStudioState();
  const flow = base.classifications.find((row) => row.id === "cls-linear-heating-flow");
  assert.ok(flow);
  const studio: StudioState = {
    ...base,
    activeLayerId: "heating",
    scales: [{ id: "scale-1", documentId: "doc-1", page: 1, metresPerUnit: 0.01, label: "1:100" }],
    geometries: [
      {
        id: "geo-flow",
        kind: "linear",
        classificationId: flow.id,
        documentId: "doc-1",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        material: "Copper",
        diameter: "22mm",
        layerId: "heating",
      },
      {
        id: "geo-trv",
        kind: "count",
        classificationId: "cls-count-trv",
        documentId: "doc-1",
        page: 1,
        point: { x: 10, y: 10 },
        layerId: "heating",
      },
      {
        id: "geo-check",
        kind: "count",
        classificationId: "cls-count-check-valve",
        documentId: "doc-1",
        page: 1,
        point: { x: 20, y: 20 },
        layerId: "heating",
      },
    ],
  };
  const lines = buildTakeoffTenderBoqLines(studio, {
    documents: [{ id: "doc-1", fileName: "plan.pdf", notes: withHouseTypeNote([], "House Type A") }],
  });
  const measured = lines.filter((line) => line.kind === "measured");
  assert.ok(measured.some((line) => /TRV/i.test(line.description) && line.section === "Heating"));
  assert.ok(measured.some((line) => /check valve/i.test(line.description) && line.section === "Heating"));
  assert.ok(measured.every((line) => line.section === "Heating"));
  assert.equal(
    lines.some((line) => /unspecified/i.test(`${line.section || ""} ${line.description || ""}`)),
    false,
  );
});

test("hot-and-cold pipe plus a generic fitting stay in Hot & cold, never Unspecified", () => {
  const base = createDefaultStudioState();
  const cold = base.classifications.find((row) => row.id === "cls-ai-P-PIPE-C");
  assert.ok(cold);
  const studio: StudioState = {
    ...base,
    activeLayerId: "hot-cold",
    scales: [{ id: "scale-1", documentId: "doc-1", page: 1, metresPerUnit: 0.01, label: "1:100" }],
    geometries: [
      {
        id: "geo-cold",
        kind: "linear",
        classificationId: cold.id,
        documentId: "doc-1",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        material: "Copper",
        diameter: "15mm",
        layerId: "hot-cold",
      },
      {
        id: "geo-elbow",
        kind: "count",
        classificationId: "cls-fit-90-elbow",
        documentId: "doc-1",
        page: 1,
        point: { x: 50, y: 0 },
        fittingKind: "90-elbow",
        linkedLinearId: "geo-cold",
        autoGenerated: true,
        material: "Copper",
        diameter: "15mm",
        layerId: "hot-cold",
      },
    ],
  };
  const lines = buildTakeoffTenderBoqLines(studio, {
    documents: [{ id: "doc-1", fileName: "services layout.pdf", notes: withHouseTypeNote([], "House Type A") }],
  });
  const measured = lines.filter((line) => line.kind === "measured");
  assert.ok(measured.some((line) => /15mm/i.test(line.description) && line.section === "Hot & cold"));
  assert.ok(measured.some((line) => /elbow/i.test(line.description) && line.section === "Hot & cold"));
  assert.ok(measured.every((line) => line.section === "Hot & cold"));
  assert.equal(
    lines.some((line) => /unspecified/i.test(`${line.section || ""} ${line.description || ""}`)),
    false,
  );
});

test("buildTakeoffTenderBoqLines splits two house types into two tabs", () => {
  const base = studioWithTwoLayers();
  const hotClsId = base.geometries.find((geo) => geo.id === "geo-cold")!.classificationId;
  const studio: StudioState = {
    ...base,
    scales: [
      { documentId: "doc-a", page: 1, metresPerUnit: 0.01, label: "1:100" },
      { documentId: "doc-b", page: 1, metresPerUnit: 0.01, label: "1:100" },
    ],
    geometries: [
      {
        id: "geo-a",
        kind: "linear",
        classificationId: hotClsId,
        documentId: "doc-a",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        material: "Copper",
        diameter: "15mm",
      },
      {
        id: "geo-b",
        kind: "linear",
        classificationId: hotClsId,
        documentId: "doc-b",
        page: 1,
        points: [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
        ],
        material: "Copper",
        diameter: "15mm",
      },
    ],
  };
  const lines = buildTakeoffTenderBoqLines(studio, {
    documents: [
      { id: "doc-a", fileName: "a.pdf", notes: withHouseTypeNote([], "House Type A") },
      { id: "doc-b", fileName: "b.pdf", notes: withHouseTypeNote([], "House Type B") },
    ],
  });
  const sheets = [...new Set(lines.map((line) => line.sheet).filter(Boolean))].sort();
  assert.deepEqual(sheets, [
    `${TAKEOFF_BOQ_SHEET_PREFIX}House Type A`,
    `${TAKEOFF_BOQ_SHEET_PREFIX}House Type B`,
  ]);
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
      sheet: `${TAKEOFF_BOQ_SHEET_PREFIX}House Type A`,
      section: "Pipework",
    },
  ];
  const next = buildTakeoffTenderBoqLines(studioWithTwoLayers(), {
    documents: [
      {
        id: "doc-1",
        fileName: "plan.pdf",
        notes: withHouseTypeNote([], "House Type A"),
      },
    ],
  });
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
      {
        id: "doc-ground",
        fileName: "Ground floor - gas.pdf",
        notes: withHouseTypeNote([], "House Type A"),
      },
      {
        id: "doc-first",
        fileName: "First floor - gas.pdf",
        notes: withHouseTypeNote([], "House Type A"),
      },
    ],
  });
  assert.ok(lines.some((line) => line.description === "Ground"));
  assert.ok(lines.some((line) => line.description === "First"));
  assert.ok(lines.some((line) => line.kind === "measured" && (line.note || "").includes("Ground")));
  assert.ok(lines.some((line) => line.kind === "measured" && (line.note || "").includes("First")));
  assert.ok(lines.filter((line) => line.kind === "measured").every((line) => line.section === "Hot & cold"));
});
