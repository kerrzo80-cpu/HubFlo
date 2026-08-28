import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseKitsFromXlsxBuffer, parseKitsFromXlsxRows } from "./kit-xlsx-import";
import { explodeKitOntoJob } from "./kit-apply";

test("parseKitsFromXlsxRows groups kit headers and labour lines", () => {
  const rows = [
    ["", "PRE BUILDS", "", ""],
    ["", "ITEM", "", "QTY"],
    ["BATH", "1700x700mm bath", "", "1"],
    ["", "Bath filler", "", "1"],
    ["", "Labour", "", "4"],
    ["Close coupled toilet", "Close coupled toilet pan", "", "1"],
    ["", "Labour", "", ""],
  ];
  const parsed = parseKitsFromXlsxRows(rows);
  assert.equal(parsed.kits.length, 2);
  assert.equal(parsed.kits[0]?.name, "BATH");
  assert.equal(parsed.kits[0]?.lines.length, 3);
  assert.equal(parsed.kits[0]?.lines[2]?.kind, "Labour");
  assert.equal(parsed.kits[0]?.lines[2]?.quantity, 4);
  assert.equal(parsed.kits[1]?.name, "Close coupled toilet");
  assert.equal(parsed.kits[1]?.category, "Bathroom");
});

test("note fragments in column A stay on the open kit", () => {
  const rows = [
    ["Build in shower valve", "Built in shower valve", "", "1"],
    ["Check depth of partition to", '15x1/2" wall elbow', "", "2"],
    ["make sure valve can fit in wall", "15mm copper pipe", "", "2"],
    ["", "first fix labour", "", "5"],
  ];
  const parsed = parseKitsFromXlsxRows(rows);
  assert.equal(parsed.kits.length, 1);
  assert.equal(parsed.kits[0]?.name, "Build in shower valve");
  assert.ok((parsed.kits[0]?.lines.length || 0) >= 4);
  assert.equal(parsed.kits[0]?.lines.at(-1)?.kind, "Labour");
  assert.equal(parsed.kits[0]?.lines.at(-1)?.quantity, 5);
});

test("office Pre builds template imports as bathroom kits", () => {
  const fixture = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/kits-prebuilds-template.xlsx",
  );
  const buffer = readFileSync(fixture);
  const parsed = parseKitsFromXlsxBuffer(buffer, "kits-prebuilds-template.xlsx");
  assert.ok(parsed.kits.length >= 10, `expected many kits, got ${parsed.kits.length}`);
  const bath = parsed.kits.find((kit) => /^bath$/i.test(kit.name));
  assert.ok(bath);
  assert.ok((bath?.lines.length || 0) >= 10);
  assert.ok(bath?.lines.some((line) => line.kind === "Labour"));
  assert.ok(parsed.kits.every((kit) => kit.lines.length > 0));
  // Shower valve note rows must not become separate kits
  assert.equal(
    parsed.kits.filter((kit) => /check depth|make sure valve/i.test(kit.name)).length,
    0,
  );
});

test("EWG Pre builds xlsx groups bath kit lines instead of one row per item", () => {
  const fixture = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/pre-builds-template-ewg.xlsx",
  );
  const buffer = readFileSync(fixture);
  const parsed = parseKitsFromXlsxBuffer(buffer, "pre-builds-template-ewg.xlsx");
  const bath = parsed.kits.find((kit) => /^bath$/i.test(kit.name));
  assert.ok(bath, "expected BATH kit");
  assert.ok((bath?.lines.length || 0) >= 15, `BATH should bundle many lines, got ${bath?.lines.length}`);
  assert.ok(
    parsed.kits.length < 20,
    `expected grouped kits, not ${parsed.kits.length} one-line kits`,
  );
});

const BATH_KIT_ROWS: string[][] = [
  ["Bath"],
  ["1700x700mm bath", "1"],
  ["1700mm bath panel", "1"],
  ["700mm bath panel", "1"],
  ["Bath filler", "1"],
  ["Bath waste and overflow", "1"],
  ["100x20mm timber 2.4m", "2"],
  ['3/4" x 22mm flexi tap conector', "2"],
  ["22mm copper pipe length", "1"],
  ["22mm press elbow", "6"],
  ["TMV?"],
  ["40mm waste pipe length", "1"],
  ["40mm bath trap", "1"],
  ["40mm 90 degree bends", "2"],
  ["40mm 45 degree bends", "2"],
  ["40mm couplings", "1"],
  ["Labour", "4"],
];

test("two-column Bath kit keeps components plus labour and skips blank TMV", () => {
  const parsed = parseKitsFromXlsxRows(BATH_KIT_ROWS, "Bath");
  assert.equal(parsed.kits.length, 1);
  assert.equal(parsed.kits[0]?.name, "Bath");
  const materials = parsed.kits[0]?.lines.filter((line) => line.kind === "Material") || [];
  const labour = parsed.kits[0]?.lines.filter((line) => line.kind === "Labour") || [];
  assert.equal(materials.length, 14);
  assert.equal(labour.length, 1);
  assert.equal(labour[0]?.quantity, 4);
  assert.equal(
    parsed.kits[0]?.lines.some((line) => /tmv/i.test(line.description)),
    false,
  );
  assert.ok(parsed.skippedOptional >= 1);
  assert.ok(parsed.rowErrors.some((row) => /tmv/i.test(row.message)));
});

test("blank TMV row does not crash or become its own kit", () => {
  const parsed = parseKitsFromXlsxRows([
    ["Bath", "1700x700mm bath", "", "1"],
    ["", "TMV?", "", ""],
    ["", "Labour", "", "4"],
  ]);
  assert.equal(parsed.kits.length, 1);
  assert.equal(parsed.kits[0]?.lines.filter((line) => line.kind === "Material").length, 1);
  assert.equal(parsed.kits[0]?.lines.at(-1)?.kind, "Labour");
  assert.equal(parsed.kits[0]?.lines.at(-1)?.quantity, 4);
});

test("upload Bath spreadsheet then apply to a cost centre explodes materials plus 4h labour", () => {
  const parsed = parseKitsFromXlsxRows(BATH_KIT_ROWS, "Bath");
  const kit = parsed.kits[0];
  assert.ok(kit);
  const exploded = explodeKitOntoJob(
    { id: "kit-bath", name: kit.name, lines: kit.lines },
    [
      { id: "labour-engineer", type: "Labour", name: "Engineer labour", costRate: 40, sellRate: 52 },
      { id: "material-bath-1700", type: "Material", name: "1700x700mm bath", costRate: 220, sellRate: 286 },
    ],
    { now: 1 },
  );
  assert.equal(exploded.materials.length, 14);
  assert.equal(exploded.labour.reduce((sum, line) => sum + line.hours, 0), 4);
  assert.equal(exploded.materials.some((line) => /^bath$/i.test(line.description)), false);
});
