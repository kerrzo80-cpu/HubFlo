import assert from "node:assert/strict";
import test from "node:test";

import { KITS_CSV_TEMPLATE, parseKitsFromCsvText } from "./kit-csv-import.ts";

test("parseKitsFromCsvText groups rows by kit_name", () => {
  const parsed = parseKitsFromCsvText(KITS_CSV_TEMPLATE, "kits-template.csv");
  assert.equal(parsed.kits.length, 2);
  const bath = parsed.kits.find((kit) => /^bath$/i.test(kit.name));
  assert.ok(bath);
  assert.equal(bath?.lines.length, 9);
  assert.ok(bath?.lines.some((line) => line.kind === "Labour" && line.quantity === 4));
  const toilet = parsed.kits.find((kit) => /close coupled toilet/i.test(kit.name));
  assert.ok(toilet);
  assert.equal(toilet?.lines.length, 3);
});

test("parseKitsFromCsvText rejects files without kit_name column", () => {
  assert.throws(
    () => parseKitsFromCsvText("description,qty\nBath panel,1\n", "bad.csv"),
    /needs a kit_name column/,
  );
});
