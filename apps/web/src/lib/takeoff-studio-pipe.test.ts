import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampRiseDropM,
  createDefaultStudioState,
  isAiStudioGeometry,
  linearMeasuredMetres,
  resolveLinearDrop,
  syncLinearDropFields,
} from "./takeoff-studio";
import {
  appendLinearWithAutoFittings,
  couplingPointsAlongRun,
  elbowPointsAlongRun,
  isRightAngleBend,
  previewFittingsForDraft,
  countUnscaledStudioLinears,
  summariseStudioBoq,
  summariseStudioPipeBoq,
  updateLinearDrops,
  updateLinearPointsWithFittings,
  updateLinearRiseDropM,
} from "./takeoff-studio-pipe";

describe("studio pipe auto fittings", () => {
  it("detects right-angle bends and ignores shallow turns", () => {
    assert.equal(
      isRightAngleBend({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }),
      true,
    );
    assert.equal(
      isRightAngleBend({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 5 }),
      false,
    );
    // Finger-tap corner that is a bit short / not perfectly square still counts
    assert.equal(
      isRightAngleBend({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 22, y: 18 }),
      true,
    );
  });

  it("previews elbows/couplings before Done run", () => {
    const preview = previewFittingsForDraft(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
        { x: 160, y: 80 },
        { x: 160, y: 20 },
      ],
      { metresPerUnit: 0.1, stockLengthM: 3, autoElbows: true, autoCouplings: true },
    );
    assert.equal(preview.elbows, 3);
    assert.ok((preview.metres || 0) > 20);
    assert.ok(preview.couplings >= 6);
  });

  it("places elbows at direction changes", () => {
    const elbows = elbowPointsAlongRun([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 160, y: 80 },
    ]);
    assert.equal(elbows.length, 2);
    assert.equal(elbows[0]?.x, 100);
    assert.equal(elbows[1]?.y, 80);
  });

  it("places couplings every 3 m along the run", () => {
    // 10 m run at 10 units per metre
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const couplings = couplingPointsAlongRun(points, 0.1, 3);
    assert.equal(couplings.length, 3);
    assert.ok(Math.abs((couplings[0]?.x || 0) - 30) < 0.01);
    assert.ok(Math.abs((couplings[2]?.x || 0) - 90) < 0.01);
  });

  it("appends copper run with auto elbows and BOQ rows", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: 0.1 }],
    };
    const next = appendLinearWithAutoFittings(studio, {
      id: "run-1",
      classificationId: "cls-ai-P-PIPE-C",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      material: "Copper",
      diameter: "22mm",
      stockLengthM: 3,
      pipeSpecId: "cu-22",
    });
    const elbows = next.geometries.filter((geo) => geo.kind === "count" && geo.fittingKind === "90-elbow");
    const couplings = next.geometries.filter((geo) => geo.kind === "count" && geo.fittingKind === "coupling");
    assert.equal(elbows.length, 1);
    assert.ok(couplings.length >= 4); // ~15 m run → 4 couplings at 3/6/9/12
    const boq = summariseStudioPipeBoq(next);
    assert.ok(boq.some((row) => row.unit === "m" && row.description.includes("22mm Copper")));
    assert.ok(boq.some((row) => row.description.includes("90° elbow")));
    assert.ok(boq.some((row) => row.description.includes("Coupling")));

    const hotCold = summariseStudioBoq(next, "hot-cold");
    assert.ok(hotCold.some((row) => row.section === "Pipework"));
    assert.ok(hotCold.every((row) => row.layerId === "hot-cold"));
    const heatingOnly = summariseStudioBoq(next, "heating");
    assert.equal(heatingOnly.length, 0);
  });

  it("does not create an Unspecified floor split when the drawing name has no level", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: 0.1 }],
    };
    const next = appendLinearWithAutoFittings(studio, {
      id: "run-1",
      classificationId: "cls-ai-P-PIPE-C",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      material: "Copper",
      diameter: "15mm",
      layerId: "hot-cold",
    });
    const rows = summariseStudioBoq(next, "hot-cold", {
      documentNames: { "doc-1": "services layout.pdf" },
    });
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.layerId === "hot-cold"));
    assert.ok(rows.every((row) => !row.floorLabel));
  });

  it("keeps unscaled runs off the BOQ (warn separately, never Push as fake qty)", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      geometries: [
        {
          id: "run-unscaled",
          classificationId: "cls-ai-P-PIPE-C",
          kind: "linear",
          documentId: "doc-1",
          page: 1,
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
          ],
          material: "Copper",
          diameter: "15mm",
        },
      ],
    };
    const boq = summariseStudioBoq(studio, "hot-cold");
    assert.equal(boq.length, 0);
    assert.equal(countUnscaledStudioLinears(studio, "hot-cold"), 1);
  });

  it("updates AI pipe vertices, regenerates fittings, and accepts as manual", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: 0.1 }],
    };
    studio = appendLinearWithAutoFittings(studio, {
      id: "ai-run-1",
      classificationId: "cls-ai-P-PIPE-C",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      material: "Copper",
      diameter: "22mm",
      stockLengthM: 3,
      pipeSpecId: "cu-22",
      source: "ai",
      notes: "Blake vision",
    });
    assert.equal(isAiStudioGeometry(studio.geometries.find((g) => g.id === "ai-run-1")!), true);

    const next = updateLinearPointsWithFittings(
      studio,
      "ai-run-1",
      [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 60 },
        { x: 140, y: 60 },
      ],
      { acceptAsManual: true },
    );
    const linears = next.geometries.filter((geo) => geo.kind === "linear" && geo.id === "ai-run-1");
    assert.equal(linears.length, 1);
    const linear = linears[0];
    assert.ok(linear && linear.kind === "linear");
    assert.equal(linear.points.length, 4);
    assert.equal(linear.source, "manual");
    assert.equal(isAiStudioGeometry(linear), false);
    assert.match(linear.notes || "", /Edited on sheet/);
    const elbows = next.geometries.filter(
      (geo) => geo.kind === "count" && geo.fittingKind === "90-elbow" && geo.linkedLinearId === "ai-run-1",
    );
    assert.equal(elbows.length, 2);
  });
});

describe("studio rise / drop metres", () => {
  it("clamps rise/drop and adds vertical to plan metres", () => {
    assert.equal(clampRiseDropM(-2), 0);
    assert.equal(clampRiseDropM(undefined), 0);
    // 100 units × 0.1 m/u = 10 m plan + 2.4 m drop
    assert.equal(
      linearMeasuredMetres([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.1, 2.4),
      12.4,
    );
    assert.equal(
      linearMeasuredMetres([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.1, -1),
      10,
    );
    // Rise alone still counts when scale is missing
    assert.equal(
      linearMeasuredMetres([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, 2.4),
      2.4,
    );
  });

  it("includes rise/drop in BOQ metres and description note", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: 0.1 }],
    };
    studio = appendLinearWithAutoFittings(studio, {
      id: "run-drop",
      classificationId: "cls-ai-P-PIPE-C",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      material: "Copper",
      diameter: "22mm",
      stockLengthM: 3,
      pipeSpecId: "cu-22",
      riseDropM: 2.4,
    });
    const pipeRows = summariseStudioPipeBoq(studio).filter((row) => row.unit === "m");
    assert.equal(pipeRows.length, 1);
    assert.equal(pipeRows[0]?.quantity, 12.4);
    assert.match(pipeRows[0]?.description || "", /incl\. 2\.4 m drop/);

    const elbows = studio.geometries.filter(
      (geo) => geo.kind === "count" && geo.fittingKind === "90-elbow" && geo.linkedLinearId === "run-drop",
    );
    assert.equal(elbows.length, 1); // ceiling→wall elbow only (straight plan run)
    assert.ok(elbows[0]?.id?.endsWith("-elbow-rise"));
  });

  it("persists rise/drop updates and regenerates the rise elbow", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: 0.1 }],
    };
    studio = appendLinearWithAutoFittings(studio, {
      id: "run-edit",
      classificationId: "cls-ai-P-PIPE-H",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      material: "Copper",
      diameter: "15mm",
      stockLengthM: 3,
      pipeSpecId: "cu-15",
    });
    assert.equal(
      summariseStudioPipeBoq(studio).find((row) => row.unit === "m")?.quantity,
      5,
    );

    studio = updateLinearRiseDropM(studio, "run-edit", 3);
    const linear = studio.geometries.find((geo) => geo.id === "run-edit");
    assert.ok(linear && linear.kind === "linear");
    assert.equal(linear.riseDropM, 3);
    const pipe = summariseStudioPipeBoq(studio).find((row) => row.unit === "m");
    assert.equal(pipe?.quantity, 8);
    assert.match(pipe?.description || "", /incl\. 3 m drop/);
    assert.ok(
      studio.geometries.some(
        (geo) => geo.kind === "count" && geo.id === "run-edit-elbow-rise",
      ),
    );

    studio = updateLinearRiseDropM(studio, "run-edit", 0);
    assert.equal(
      studio.geometries.find((geo) => geo.id === "run-edit" && geo.kind === "linear")?.riseDropM,
      0,
    );
    assert.equal(
      studio.geometries.some((geo) => geo.kind === "count" && geo.id === "run-edit-elbow-rise"),
      false,
    );
  });

  it("counts extra couplings for rise metres past stock length", () => {
    // 2 m plan + 4 m drop = 6 m → ceil((6-0.001)/3)-1 = 1 coupling
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
    const without = couplingPointsAlongRun(points, 0.1, 3, 0);
    const withRise = couplingPointsAlongRun(points, 0.1, 3, 4);
    assert.equal(without.length, 0);
    assert.equal(withRise.length, 1);
  });

  it("resolves N×H vertical metres and migrates bare riseDropM", () => {
    assert.equal(resolveLinearDrop({ dropCount: 3, dropHeightM: 2.4 }).verticalM, 7.2);
    assert.equal(resolveLinearDrop({ dropCount: 3, dropHeightM: 2.4 }).elbowCount, 3);
    assert.equal(resolveLinearDrop({ dropCount: 3, dropHeightM: 2.4 }).noteLabel, "3 × 2.4 m drops");
    assert.equal(resolveLinearDrop({ dropCount: 1, dropHeightM: 2.4 }).noteLabel, "2.4 m drop");

    // Legacy single field → 1 × height
    const legacy = resolveLinearDrop({ riseDropM: 2.4 });
    assert.equal(legacy.dropCount, 1);
    assert.equal(legacy.dropHeightM, 2.4);
    assert.equal(legacy.verticalM, 2.4);
    assert.equal(legacy.elbowCount, 1);

    // count 0 keeps total override
    const total = resolveLinearDrop({ dropCount: 0, dropHeightM: 0, riseDropM: 5 });
    assert.equal(total.verticalM, 5);
    assert.equal(total.mode, "total");
    assert.equal(total.elbowCount, 1);

    const synced = syncLinearDropFields({ riseDropM: 3 });
    assert.equal(synced.dropCount, 1);
    assert.equal(synced.dropHeightM, 3);
    assert.equal(synced.riseDropM, 3);
  });

  it("1 drop × 3m adds exactly +3.0m vertical (never × plan scale)", () => {
    // Bug regression: status showed ~5.74 next to Vert when plan was ~2.74m + 3m drop.
    // Vertical allowance must stay N×H in real metres — do not multiply height by metresPerUnit.
    const drop = resolveLinearDrop({ dropCount: 1, dropHeightM: 3 });
    assert.equal(drop.verticalM, 3);
    assert.equal(drop.noteLabel, "3 m drop");

    // Calibration-style scale label from the bug report (~2.777 m known length).
    const mpu = 2.777;
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const planM = 1 * mpu;
    const totalM = linearMeasuredMetres(points, mpu, drop.verticalM);
    assert.equal(planM, 2.777);
    assert.equal(totalM, 5.777); // plan + 3 — looks like the old confusing "5.74" total
    assert.equal(drop.verticalM, 3); // not 5.777, not 3×2.777
    assert.notEqual(drop.verticalM, 3 * mpu);

    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: mpu }],
    };
    studio = appendLinearWithAutoFittings(studio, {
      id: "run-1x3-drop",
      classificationId: "cls-ai-P-PIPE-C",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points,
      material: "Copper",
      diameter: "22mm",
      stockLengthM: 3,
      pipeSpecId: "cu-22",
      dropCount: 1,
      dropHeightM: 3,
    });
    const pipeRow = summariseStudioPipeBoq(studio).find((row) => row.unit === "m");
    assert.equal(pipeRow?.quantity, 5.78); // Number((2.777 + 3).toFixed(2))
    assert.match(pipeRow?.description || "", /incl\. 3 m drop/);
    // BoQ metres = plan×scale + N×H; vertical piece is still exactly 3.0 before qty rounding
    assert.equal(linearMeasuredMetres(points, mpu, drop.verticalM) - planM, 3);
  });

  it("BOQ uses count × height with plural drop note and one elbow per drop", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: 0.1 }],
    };
    studio = appendLinearWithAutoFittings(studio, {
      id: "run-multi-drop",
      classificationId: "cls-ai-P-PIPE-C",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      material: "Copper",
      diameter: "22mm",
      stockLengthM: 3,
      pipeSpecId: "cu-22",
      dropCount: 3,
      dropHeightM: 2.4,
    });

    const linear = studio.geometries.find((geo) => geo.id === "run-multi-drop");
    assert.ok(linear && linear.kind === "linear");
    assert.equal(linear.dropCount, 3);
    assert.equal(linear.dropHeightM, 2.4);
    assert.equal(linear.riseDropM, 7.2); // synced vertical total

    // 10 m plan + 7.2 m vertical
    const pipeRows = summariseStudioPipeBoq(studio).filter((row) => row.unit === "m");
    assert.equal(pipeRows.length, 1);
    assert.equal(pipeRows[0]?.quantity, 17.2);
    assert.match(pipeRows[0]?.description || "", /incl\. 3 × 2\.4 m drops/);

    const elbows = studio.geometries.filter(
      (geo) => geo.kind === "count" && geo.fittingKind === "90-elbow" && geo.linkedLinearId === "run-multi-drop",
    );
    assert.equal(elbows.length, 3);
    // Spaced along the 100-unit run at 1/3, 2/3, end — not stacked at the end.
    const xs = elbows
      .map((geo) => (geo.kind === "count" ? geo.point.x : 0))
      .sort((a, b) => a - b);
    assert.ok(Math.abs(xs[0]! - 100 / 3) < 0.5);
    assert.ok(Math.abs(xs[1]! - 200 / 3) < 0.5);
    assert.ok(Math.abs(xs[2]! - 100) < 0.5);

    studio = updateLinearDrops(studio, "run-multi-drop", { dropCount: 2, dropHeightM: 2.4 });
    assert.equal(
      summariseStudioPipeBoq(studio).find((row) => row.unit === "m")?.quantity,
      14.8, // 10 + 4.8
    );
    assert.equal(
      studio.geometries.filter(
        (geo) => geo.kind === "count" && geo.fittingKind === "90-elbow" && geo.linkedLinearId === "run-multi-drop",
      ).length,
      2,
    );
  });

  it("migrates riseDropM-only linears to dropCount=1 on save", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: 0.1 }],
    };
    studio = appendLinearWithAutoFittings(studio, {
      id: "run-legacy",
      classificationId: "cls-ai-P-PIPE-H",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      material: "Copper",
      diameter: "15mm",
      stockLengthM: 3,
      pipeSpecId: "cu-15",
      riseDropM: 2.4,
    });
    const linear = studio.geometries.find((geo) => geo.id === "run-legacy");
    assert.ok(linear && linear.kind === "linear");
    assert.equal(linear.dropCount, 1);
    assert.equal(linear.dropHeightM, 2.4);
    assert.equal(linear.riseDropM, 2.4);
    assert.equal(
      summariseStudioPipeBoq(studio).find((row) => row.unit === "m")?.quantity,
      7.4, // 5 + 2.4
    );
  });
});
