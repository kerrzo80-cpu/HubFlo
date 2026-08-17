import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

import type { TenderBoqLine } from "@/lib/tenders-types";

const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-boq-move-"));
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";

let writeServerStore: typeof import("@/lib/server-store").writeServerStore;
let filterBoqLinesBySheet: typeof import("@/lib/tender-boq-sections").filterBoqLinesBySheet;
let listBoqSheetTabs: typeof import("@/lib/tender-boq-sections").listBoqSheetTabs;
let addBoqMeasuredLine: typeof import("@/lib/tenders-data").addBoqMeasuredLine;
let addBoqSheetTab: typeof import("@/lib/tenders-data").addBoqSheetTab;
let getTender: typeof import("@/lib/tenders-data").getTender;
let mergeBoqLinesIntoSheet: typeof import("@/lib/tenders-data").mergeBoqLinesIntoSheet;
let moveBoqLinesToSheet: typeof import("@/lib/tenders-data").moveBoqLinesToSheet;
let upsertTender: typeof import("@/lib/tenders-data").upsertTender;

before(async () => {
  ({ writeServerStore } = await import("@/lib/server-store"));
  const sections = await import("@/lib/tender-boq-sections");
  filterBoqLinesBySheet = sections.filterBoqLinesBySheet;
  listBoqSheetTabs = sections.listBoqSheetTabs;
  const tenders = await import("@/lib/tenders-data");
  addBoqMeasuredLine = tenders.addBoqMeasuredLine;
  addBoqSheetTab = tenders.addBoqSheetTab;
  getTender = tenders.getTender;
  mergeBoqLinesIntoSheet = tenders.mergeBoqLinesIntoSheet;
  moveBoqLinesToSheet = tenders.moveBoqLinesToSheet;
  upsertTender = tenders.upsertTender;
});

function seedTender(id: string, lines: TenderBoqLine[]) {
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  return upsertTender({
    id,
    name: "BoQ move test",
    client: "EWG",
    category: "Plumbing",
    area: "Aberdeen",
    status: "In Progress",
    boqLines: lines,
  });
}

function snapshotSheet(lines: TenderBoqLine[], sheet: string) {
  return filterBoqLinesBySheet(lines, sheet).map((line) => ({
    id: line.id,
    kind: line.kind,
    description: line.description,
    quantity: line.quantity ?? null,
    rate: line.rate ?? null,
    sheet: line.sheet,
  }));
}

describe("BoQ move / merge lines across sheet tabs", () => {
  it("Add line on a header-only sheet stays on that tab after save/reload", () => {
    seedTender("tender-boq-add-line", [
      {
        id: "gen-h",
        kind: "header",
        description: "General items",
        sheet: "General items",
        section: "General items",
      },
      {
        id: "heat-h",
        kind: "header",
        description: "Heating",
        sheet: "Heating",
        section: "Heating",
      },
    ]);

    const added = addBoqMeasuredLine("tender-boq-add-line", {
      sheet: "Heating",
      description: "TRV",
      quantity: 4,
      unit: "nr",
    });
    const line = added.boqLines.find((row) => row.description === "TRV");
    assert.ok(line);
    assert.equal(line?.sheet, "Heating");
    assert.match(line!.id, /^boq-/);
    assert.notEqual(line?.id, "gen-h");
    assert.notEqual(line?.id, "heat-h");

    const reloaded = getTender("tender-boq-add-line");
    assert.ok(reloaded);
    assert.equal(reloaded.boqLines.find((row) => row.id === line!.id)?.sheet, "Heating");
    assert.equal(
      filterBoqLinesBySheet(reloaded.boqLines, "General items").filter((row) => row.kind === "measured").length,
      0,
    );
  });

  it("moves selected lines from sheet A onto sheet B without scrambling siblings", () => {
    seedTender("tender-boq-move", [
      {
        id: "gen-h",
        kind: "header",
        description: "General items",
        sheet: "General items",
        section: "General items",
      },
      {
        id: "rad-1",
        kind: "measured",
        ref: "H1",
        description: "Radiator",
        quantity: 2,
        unit: "nr",
        rate: 120,
        value: 240,
        sheet: "General items",
        section: "General items",
      },
      {
        id: "prelim-1",
        kind: "measured",
        ref: "G1",
        description: "Preliminaries",
        quantity: 1,
        unit: "item",
        rate: 500,
        value: 500,
        sheet: "General items",
        section: "General items",
      },
      {
        id: "heat-h",
        kind: "header",
        description: "Heating",
        sheet: "Heating",
        section: "Heating",
      },
      {
        id: "cyl-1",
        kind: "measured",
        ref: "H2",
        description: "Cylinder",
        quantity: 1,
        unit: "nr",
        rate: 800,
        value: 800,
        sheet: "Heating",
        section: "Heating",
      },
    ]);

    const heatingBefore = snapshotSheet(getTender("tender-boq-move")!.boqLines, "Heating");
    const result = moveBoqLinesToSheet("tender-boq-move", ["rad-1"], "Heating");
    assert.equal(result.sheetKey, "Heating");
    assert.equal(result.movedCount, 1);
    assert.equal(result.tender.boqLines.find((line) => line.id === "rad-1")?.sheet, "Heating");
    assert.equal(result.tender.boqLines.find((line) => line.id === "prelim-1")?.sheet, "General items");
    assert.equal(result.tender.boqLines.find((line) => line.id === "cyl-1")?.sheet, "Heating");
    assert.equal(result.tender.boqLines.find((line) => line.id === "rad-1")?.id, "rad-1");

    const heatingAfterMove = snapshotSheet(result.tender.boqLines, "Heating");
    assert.deepEqual(
      heatingAfterMove.filter((row) => row.id !== "rad-1"),
      heatingBefore,
    );

    const reloaded = getTender("tender-boq-move");
    assert.ok(reloaded);
    assert.equal(reloaded.boqLines.find((line) => line.id === "rad-1")?.sheet, "Heating");
    assert.equal(reloaded.boqLines.find((line) => line.id === "prelim-1")?.sheet, "General items");
    assert.deepEqual(
      snapshotSheet(reloaded.boqLines, "Heating").filter((row) => row.id !== "rad-1"),
      heatingBefore,
    );
  });

  it("merges selected lines into an existing tab and keeps them after reload", () => {
    seedTender("tender-boq-merge", [
      {
        id: "gen-h",
        kind: "header",
        description: "General items",
        sheet: "General items",
        section: "General items",
      },
      {
        id: "pipe-1",
        kind: "measured",
        description: "15mm copper",
        quantity: 12,
        unit: "m",
        sheet: "General items",
        section: "General items",
      },
      {
        id: "pipe-2",
        kind: "measured",
        description: "22mm copper",
        quantity: 8,
        unit: "m",
        sheet: "General items",
        section: "General items",
      },
      {
        id: "heat-h",
        kind: "header",
        description: "Heating",
        sheet: "Heating",
        section: "Heating",
      },
      {
        id: "boiler-1",
        kind: "measured",
        description: "Boiler",
        quantity: 1,
        unit: "nr",
        sheet: "Heating",
        section: "Heating",
      },
    ]);

    const result = mergeBoqLinesIntoSheet("tender-boq-merge", {
      lineIds: ["pipe-1", "pipe-2"],
      targetName: "Heating",
      sourceSheet: "General items",
    });
    assert.equal(result.movedCount, 2);
    assert.equal(result.tender.boqLines.find((line) => line.id === "pipe-1")?.sheet, "Heating");
    assert.equal(result.tender.boqLines.find((line) => line.id === "pipe-2")?.sheet, "Heating");
    assert.equal(result.tender.boqLines.find((line) => line.id === "boiler-1")?.sheet, "Heating");
    assert.equal(result.tender.boqLines.find((line) => line.id === "boiler-1")?.id, "boiler-1");
    assert.equal(
      listBoqSheetTabs(result.tender.boqLines).some((tab) => tab.key === "General items"),
      false,
      "empty source tab (echo header only) should be removed on merge",
    );

    const reloaded = getTender("tender-boq-merge");
    assert.ok(reloaded);
    const heating = filterBoqLinesBySheet(reloaded.boqLines, "Heating").filter((line) => line.kind === "measured");
    assert.deepEqual(
      heating.map((line) => line.id).sort(),
      ["boiler-1", "pipe-1", "pipe-2"],
    );
    assert.equal(listBoqSheetTabs(reloaded.boqLines).some((tab) => tab.key === "General items"), false);
  });

  it("merge whole current sheet into a new tab then drops the empty source", () => {
    seedTender("tender-boq-merge-new", [
      {
        id: "gen-h",
        kind: "header",
        description: "General items",
        sheet: "General items",
        section: "General items",
      },
      {
        id: "rad-1",
        kind: "measured",
        description: "Radiator",
        quantity: 3,
        unit: "nr",
        sheet: "General items",
        section: "General items",
      },
      {
        id: "valve-1",
        kind: "measured",
        description: "TRV",
        quantity: 3,
        unit: "nr",
        sheet: "General items",
        section: "Radiators",
      },
    ]);

    const result = mergeBoqLinesIntoSheet("tender-boq-merge-new", {
      lineIds: ["rad-1", "valve-1"],
      targetName: "Heating",
      sourceSheet: "General items",
      mergeWholeSource: true,
    });
    assert.equal(result.sheetKey, "Heating");
    assert.equal(result.tender.boqLines.find((line) => line.id === "rad-1")?.sheet, "Heating");
    assert.equal(result.tender.boqLines.find((line) => line.id === "valve-1")?.section, "Radiators");
    assert.equal(listBoqSheetTabs(result.tender.boqLines).map((tab) => tab.key).join(","), "Heating");

    const reloaded = getTender("tender-boq-merge-new");
    assert.ok(reloaded);
    assert.equal(reloaded.boqLines.find((line) => line.id === "rad-1")?.id, "rad-1");
    assert.equal(reloaded.boqLines.every((line) => line.sheet === "Heating"), true);
  });

  it("Add sheet then Add line does not collide ids or spill onto other tabs", () => {
    seedTender("tender-boq-new-sheet-line", [
      {
        id: "keep-1",
        kind: "measured",
        description: "Issued basin",
        quantity: 1,
        unit: "nr",
        sheet: "Issued BoQ",
        section: "Issued BoQ",
      },
    ]);
    const sheet = addBoqSheetTab("tender-boq-new-sheet-line", "Heating");
    const withLine = addBoqMeasuredLine("tender-boq-new-sheet-line", {
      sheet: sheet.sheetKey,
      description: "New item",
    });
    const ids = withLine.boqLines.map((line) => line.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(withLine.boqLines.find((line) => line.id === "keep-1")?.sheet, "Issued BoQ");
    assert.equal(
      withLine.boqLines.find((line) => line.description === "New item")?.sheet,
      "Heating",
    );
    const reloaded = getTender("tender-boq-new-sheet-line");
    assert.equal(reloaded?.boqLines.find((line) => line.id === "keep-1")?.sheet, "Issued BoQ");
  });
});
