import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowedFixtureCodesForScan,
  clampTradeToScope,
  filterFixtureRows,
  fixtureSearchClassesForLayer,
  isElectricalFixtureClass,
  lookingForLabel,
  parseBlakeScopeInstruction,
  scanBriefForLayer,
} from "./blake-trade-scope";

describe("Blake trade-aware fixture search", () => {
  it("plumbing / heating layers do not hunt light switches or pendants", () => {
    const plumbing = fixtureSearchClassesForLayer("hot-cold");
    const heating = fixtureSearchClassesForLayer("heating");
    const master = fixtureSearchClassesForLayer("all");

    for (const set of [plumbing, heating, master]) {
      const codes = set.map((row) => row.code);
      const labels = set.map((row) => `${row.code} ${row.description}`.toLowerCase());
      assert.ok(!codes.includes("E-LIGHT"));
      assert.ok(!codes.includes("E-SWITCH"));
      assert.ok(!codes.includes("E-PENDANT"));
      assert.ok(!codes.includes("E-SOCKET"));
      assert.ok(labels.every((label) => !label.includes("light switch") && !label.includes("pendant")));
    }

    const heatingCodes = allowedFixtureCodesForScan("heating");
    assert.ok(heatingCodes.has("H-RAD") || heatingCodes.has("P-RAD"));
    assert.equal(heatingCodes.has("E-LIGHT"), false);

    const plumbingCodes = allowedFixtureCodesForScan("hot-cold");
    assert.ok(plumbingCodes.has("P-WC"));
    assert.equal(plumbingCodes.has("E-SWITCH"), false);
  });

  it("master / all still excludes lighting unless the user asked for electrical", () => {
    const without = fixtureSearchClassesForLayer("all");
    assert.ok(!without.some((row) => isElectricalFixtureClass(row.code, row.description)));

    const withElec = fixtureSearchClassesForLayer("all", {
      includeElectrical: true,
      excludeVentilation: false,
      tradeOnly: "electrical",
      notes: [],
    });
    assert.ok(withElec.some((row) => row.code === "E-LIGHT" || row.code === "E-SOCKET"));
  });

  it("drops electrical vision inventions from a plumbing scan", () => {
    const kept = filterFixtureRows(
      [
        { code: "P-WC", description: "WC" },
        { code: "E-LIGHT", description: "Pendant" },
        { code: "P-ITEM", description: "Light switch" },
        { code: "E-PENDANT", description: "Pendant fitting" },
        { code: "H-RAD", description: "Radiator" },
      ],
      { layerId: "all" },
    );
    assert.deepEqual(
      kept.map((row) => row.code),
      ["P-WC", "H-RAD"],
    );
  });

  it("heating project trade stays heating, never electrical from a mixed sheet", () => {
    assert.equal(clampTradeToScope("electrical", { includeElectrical: false, excludeVentilation: false, tradeOnly: null, notes: [] }, "heating"), "heating");
    assert.equal(clampTradeToScope("electrical", emptyScope(), "hot-cold"), "plumbing");
  });

  it("names the scan honestly from the Draw-as layer", () => {
    const heating = scanBriefForLayer("heating");
    assert.match(heating.title, /Find CAD heating/i);
    assert.match(heating.lookingFor, /heating/i);
    assert.ok(!/mystery|ask blake/i.test(heating.title));

    const plumbing = scanBriefForLayer("hot-cold");
    assert.match(plumbing.title, /Find CAD plumbing/i);
    assert.match(lookingForLabel(plumbing.targets, "hot-cold"), /hot\/cold pipes, sanitary/i);
    assert.match(lookingForLabel(plumbing.targets, "hot-cold"), /not lighting/i);
  });

  it("chat after a lighting reject marks electrical out of scope", () => {
    const parsed = parseBlakeScopeInstruction(
      "That was a light switch — I’m a plumber. Only pipework and sanitary.",
    );
    assert.equal(parsed.scope.includeElectrical, false);
    assert.equal(parsed.scope.tradeOnly, "plumbing");
    assert.ok(parsed.rejectedHints.includes("E-SWITCH"));
  });
});

function emptyScope() {
  return { includeElectrical: false, excludeVentilation: false, tradeOnly: null, notes: [] };
}
