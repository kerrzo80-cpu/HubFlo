import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import { writeServerStore } from "@/lib/server-store";
import { filterBoqLinesBySheet, listBoqSheetTabs } from "@/lib/tender-boq-sections";
import {
  getTender,
  importBoqWorkbookIntoTender,
  normalizeBoqLines,
  parseBoqFromWorkbookSheets,
  updateBoqLine,
  upsertTender,
} from "@/lib/tenders-data";
import { workbookBoqSheetsFromBuffer } from "@/lib/tenders-xlsx";
import type { TenderBoqLine } from "@/lib/tenders-types";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/tender-boq/Workbook1-multi-sheet.xlsx",
);

function snapshotBySheet(lines: TenderBoqLine[]) {
  const tabs = listBoqSheetTabs(lines);
  const out: Record<string, Array<{ id: string; ref?: string; description: string; quantity?: number | null; rate?: number | null }>> =
    {};
  for (const tab of tabs) {
    out[tab.key] = filterBoqLinesBySheet(lines, tab.key)
      .filter((line) => line.kind === "measured")
      .map((line) => ({
        id: line.id,
        ref: line.ref,
        description: line.description,
        quantity: line.quantity ?? null,
        rate: line.rate ?? null,
      }));
  }
  return out;
}

describe("BoQ sheet tab stability", () => {
  it("normalizeBoqLines heals duplicate ids and trims sheet labels once", () => {
    const lines: TenderBoqLine[] = [
      {
        id: "dup",
        kind: "measured",
        description: "Copper clip",
        quantity: 1,
        unit: "nr",
        sheet: "Clip A ",
      },
      {
        id: "dup",
        kind: "measured",
        description: "Waste clip",
        quantity: 2,
        unit: "nr",
        sheet: "Clip B",
      },
    ];
    const healed = normalizeBoqLines(lines);
    assert.equal(healed.length, 2);
    assert.equal(new Set(healed.map((line) => line.id)).size, 2);
    assert.equal(healed[0]?.sheet, "Clip A");
    assert.equal(healed[1]?.sheet, "Clip B");
    assert.notEqual(healed[0]?.id, healed[1]?.id);
  });

  it("Workbook1 multi-sheet import: one tab per worksheet, no cross-tab spill, unique ids", () => {
    const bytes = readFileSync(FIXTURE);
    const sheets = workbookBoqSheetsFromBuffer(bytes);
    assert.ok(sheets.length >= 8, `expected many worksheets, got ${sheets.length}`);

    const parsed = parseBoqFromWorkbookSheets(sheets);
    const ids = parsed.lines.map((line) => line.id);
    assert.equal(ids.length, new Set(ids).size, "every BoQ line must have a unique id");

    const tabs = listBoqSheetTabs(parsed.lines);
    assert.equal(tabs.length, sheets.length);

    for (const sheet of sheets) {
      const key = sheet.name.trim();
      const onTab = filterBoqLinesBySheet(parsed.lines, key);
      assert.ok(onTab.length > 0, `sheet ${key} should have lines`);
      assert.ok(
        onTab.every((line) => (line.sheet || "").trim() === key),
        `every line on ${key} must keep that sheet id`,
      );
    }

    // Signature items must stay on their home sheets (not spill to siblings).
    const copper = filterBoqLinesBySheet(parsed.lines, "Clip set up copper 1.5m");
    const waste = filterBoqLinesBySheet(parsed.lines, "Clip setup for waste pipes 1.5M");
    assert.ok(copper.some((line) => /15mm Rubber Lined/i.test(line.description)));
    assert.equal(
      copper.filter((line) => /110mm Rubber Lined/i.test(line.description)).length,
      0,
      "110mm clips must not appear on the copper sheet",
    );
    assert.ok(waste.some((line) => /110mm Rubber Lined/i.test(line.description)));
    assert.equal(
      waste.filter((line) => /15mm Rubber Lined/i.test(line.description)).length,
      0,
      "15mm copper clips must not appear on the waste sheet",
    );
  });

  it("import → save → reload keeps the same lines on the same tabs (no reshuffle)", () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });
    const tender = upsertTender({
      id: "tender-sheet-stable",
      name: "Sheet stability",
      client: "EWG",
      boqLines: [],
    });

    const bytes = readFileSync(FIXTURE);
    const sheets = workbookBoqSheetsFromBuffer(bytes);
    const imported = importBoqWorkbookIntoTender(tender.id, sheets, undefined, { mode: "replace" });
    const before = snapshotBySheet(imported.boqLines);
    assert.ok(Object.keys(before).length >= 8);

    // Simulate leave → reopen: fresh read from store (also runs auto-heal).
    const reloaded = getTender(tender.id);
    assert.ok(reloaded);
    const after = snapshotBySheet(reloaded.boqLines);

    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      assert.equal(after[key]?.length, before[key]?.length, `tab ${key} line count`);
      for (let i = 0; i < (before[key] || []).length; i += 1) {
        const a = before[key]![i]!;
        const b = after[key]![i]!;
        assert.equal(b.id, a.id, `${key}[${i}] id`);
        assert.equal(b.description, a.description, `${key}[${i}] description`);
        assert.equal(b.quantity, a.quantity, `${key}[${i}] qty`);
        assert.equal(b.rate, a.rate, `${key}[${i}] rate`);
      }
    }
  });

  it("editing one line never rewrites a collided sibling on another sheet", () => {
    // Write pre-corrupt store the way the old Date.now()+rand uid did (bypass upsert normalize).
    writeServerStore("nexa-tenders-v1", {
      tenders: [
        {
          id: "tender-dup-ids",
          name: "Dup ids",
          client: "EWG",
          category: "Plumbing",
          area: "Aberdeen",
          status: "In Progress",
          owner: "",
          bidValue: 0,
          tenderSum: 0,
          qualifications: [],
          daywork: { labourPerHour: 60, materialsUpliftPercent: 25, plantUpliftPercent: 20 },
          boqTitle: "",
          documents: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          boqLines: [
            {
              id: "same-id",
              kind: "measured",
              description: "On sheet A",
              quantity: 1,
              unit: "nr",
              rate: 10,
              value: 10,
              sheet: "Sheet A",
            },
            {
              id: "same-id",
              kind: "measured",
              description: "On sheet B",
              quantity: 5,
              unit: "nr",
              rate: 20,
              value: 100,
              sheet: "Sheet B",
            },
          ],
        },
      ],
    });

    // Auto-heal on read assigns unique ids before edit.
    const loaded = getTender("tender-dup-ids");
    assert.ok(loaded);
    assert.equal(new Set(loaded.boqLines.map((line) => line.id)).size, 2);

    const sheetA = loaded.boqLines.find((line) => line.sheet === "Sheet A");
    assert.ok(sheetA);
    updateBoqLine("tender-dup-ids", sheetA.id, { description: "Edited A only", rate: 99 });

    const after = getTender("tender-dup-ids");
    assert.ok(after);
    const a = after.boqLines.find((line) => line.sheet === "Sheet A");
    const b = after.boqLines.find((line) => line.sheet === "Sheet B");
    assert.equal(a?.description, "Edited A only");
    assert.equal(a?.rate, 99);
    assert.equal(b?.description, "On sheet B");
    assert.equal(b?.rate, 20);
    assert.equal(b?.sheet, "Sheet B");
  });

  it("synthetic multi-sheet workbook still isolates rows per tab", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
        ["A1", "Only on Alpha", 1, "nr", 10, 10],
      ]),
      "Alpha",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
        ["B1", "Only on Beta", 2, "nr", 20, 40],
      ]),
      "Beta",
    );
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseBoqFromWorkbookSheets(workbookBoqSheetsFromBuffer(bytes));
    assert.deepEqual(
      listBoqSheetTabs(parsed.lines).map((tab) => tab.key),
      ["Alpha", "Beta"],
    );
    assert.equal(
      filterBoqLinesBySheet(parsed.lines, "Alpha").filter((line) => /Beta/i.test(line.description)).length,
      0,
    );
    assert.equal(
      filterBoqLinesBySheet(parsed.lines, "Beta").filter((line) => /Alpha/i.test(line.description)).length,
      0,
    );
  });
});
