import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseKitsFromXlsxBuffer, parseKitsFromXlsxRows } from "./kit-xlsx-import";

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
