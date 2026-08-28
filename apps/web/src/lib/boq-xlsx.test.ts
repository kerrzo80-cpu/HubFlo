import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readXlsxFirstSheet } from "./boq-xlsx.ts";

test("readXlsxFirstSheet keeps empty self-closing cells in column order", () => {
  const fixture = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/kits-prebuilds-template.xlsx",
  );
  const { rows } = readXlsxFirstSheet(readFileSync(fixture));
  const bathHeader = rows.find((row) => String(row[0]).trim().toUpperCase() === "BATH" && String(row[1]).includes("1700"));
  assert.ok(bathHeader, "expected BATH header row");
  const headerIndex = rows.indexOf(bathHeader);
  const next = rows[headerIndex + 1] ?? [];
  assert.equal(String(next[0] ?? "").trim(), "");
  assert.ok(String(next[1] ?? "").trim().length > 0);
  assert.ok(String(next[3] ?? next[2] ?? "").trim().length > 0);
});
