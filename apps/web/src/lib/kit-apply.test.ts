import assert from "node:assert/strict";
import test from "node:test";

import { explodeKitOntoJob, explodeKitOntoQuote, type KitApplyCatalogItem, type KitApplyKit } from "./kit-apply";

const bathKit: KitApplyKit = {
  id: "kit-bath",
  name: "Bath",
  lines: [
    { kind: "Material", description: "1700x700mm bath", quantity: 1 },
    { kind: "Material", description: "1700mm bath panel", quantity: 1 },
    { kind: "Material", description: "700mm bath panel", quantity: 1 },
    { kind: "Material", description: "Bath filler", quantity: 1 },
    { kind: "Material", description: "Bath waste and overflow", quantity: 1 },
    { kind: "Material", description: "100x20mm timber 2.4m", quantity: 2 },
    { kind: "Material", description: '3/4" x 22mm flexi tap conector', quantity: 2 },
    { kind: "Material", description: "22mm copper pipe length", quantity: 1 },
    { kind: "Material", description: "22mm press elbow", quantity: 6 },
    { kind: "Material", description: "TMV?", quantity: 0 },
    { kind: "Material", description: "40mm waste pipe length", quantity: 1 },
    { kind: "Material", description: "40mm bath trap", quantity: 1 },
    { kind: "Material", description: "40mm 90 degree bends", quantity: 2 },
    { kind: "Material", description: "40mm 45 degree bends", quantity: 2 },
    { kind: "Material", description: "40mm couplings", quantity: 1 },
    { kind: "Labour", description: "Labour", quantity: 4 },
  ],
};

const catalog: KitApplyCatalogItem[] = [
  { id: "labour-engineer", type: "Labour", name: "Engineer labour", costRate: 40, sellRate: 52 },
  { id: "material-bath-1700", type: "Material", name: "1700x700mm bath", costRate: 220, sellRate: 286 },
  { id: "material-panel-1700", type: "Material", name: "1700mm bath panel", costRate: 45, sellRate: 58 },
];

test("applying Bath kit explodes catalogue children plus 4 labour hours", () => {
  const exploded = explodeKitOntoJob(bathKit, catalog, { now: 1, materialMarkupPercent: 30, labourMarkupPercent: 30 });
  assert.equal(exploded.materials.length, 14);
  assert.equal(exploded.labour.length, 1);
  assert.equal(exploded.labour[0]?.hours, 4);
  assert.equal(
    exploded.materials.some((line) => /^bath$/i.test(line.description)),
    false,
    "must not collapse to a parent Bath sell line",
  );
  assert.equal(exploded.materials[0]?.catalogItemId, "material-bath-1700");
  assert.equal(exploded.materials[0]?.description, "1700x700mm bath");
  assert.equal(exploded.materials[1]?.catalogItemId, "material-panel-1700");
  assert.equal(exploded.materials[2]?.catalogItemId, "one-off-material");
  assert.equal(exploded.skipped, 1);
  const ids = exploded.materials.map((line) => line.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("blank TMV row is skipped instead of crashing apply", () => {
  const exploded = explodeKitOntoJob(
    {
      id: "kit-bath",
      name: "Bath",
      lines: [
        { kind: "Material", description: "1700x700mm bath", quantity: 1 },
        { kind: "Material", description: "TMV?", quantity: Number.NaN },
        { kind: "Labour", description: "Labour", quantity: 4 },
      ],
    },
    catalog,
    { now: 1 },
  );
  assert.equal(exploded.materials.length, 1);
  assert.equal(exploded.labour[0]?.hours, 4);
  assert.ok(exploded.skipped >= 1);
});

test("quote apply posts hours as quantity, not one kit parent line", () => {
  const exploded = explodeKitOntoQuote(bathKit, catalog, { now: 1 });
  assert.equal(exploded.lines.some((line) => /^bath$/i.test(line.description)), false);
  const labour = exploded.lines.filter((line) => line.catalogItemId === "labour-engineer");
  assert.equal(labour.length, 1);
  assert.equal(labour[0]?.quantity, 4);
  assert.equal(exploded.lines.filter((line) => line.catalogItemId !== "labour-engineer").length, 14);
});

test("missing lines array does not throw", () => {
  const exploded = explodeKitOntoJob({ id: "kit-empty", name: "Bath", lines: null }, catalog);
  assert.equal(exploded.materials.length, 0);
  assert.equal(exploded.labour.length, 0);
});
