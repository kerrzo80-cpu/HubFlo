import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writeServerStore } from "@/lib/server-store";
import {
  addBoqMeasuredLine,
  addBoqSheetTab,
  deleteBoqLines,
  deleteBoqSheetTab,
  getTender,
  importBoqIntoTender,
  importBoqWorkbookIntoTender,
  mergeBoqImportLines,
  renameBoqSheetTab,
  upsertTender,
} from "@/lib/tenders-data";
import { listBoqSheetTabs } from "@/lib/tender-boq-sections";
import { buildTenderBoqXlsxBuffer, tenderBoqLinesToRows } from "@/lib/tenders-xlsx";
import type { TenderBoqLine } from "@/lib/tenders-types";

describe("tender BoQ append / export", () => {
  it("mergeBoqImportLines keeps existing lines and uniquifies sheet tabs", () => {
    const existing: TenderBoqLine[] = [
      {
        id: "e1",
        kind: "measured",
        ref: "1/A",
        description: "Issued basin",
        quantity: 1,
        unit: "nr",
        rate: 100,
        value: 100,
        sheet: "Page 1",
        section: "Sanitary",
      },
    ];
    const incoming: TenderBoqLine[] = [
      {
        id: "n1",
        kind: "measured",
        ref: "S1",
        description: "Supplier valve",
        quantity: 2,
        unit: "nr",
        rate: 40,
        value: 80,
        sheet: "Page 1",
        section: "Page 1",
      },
    ];

    const merged = mergeBoqImportLines(existing, incoming);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.id, "e1");
    assert.equal(merged[0]?.sheet, "Page 1");
    assert.equal(merged[1]?.sheet, "Page 1 (2)");
    assert.equal(merged[1]?.rate, 40);
  });

  it("append import does not wipe an existing priced BoQ", () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });
    const tender = upsertTender({
      id: "tender-boq-append",
      name: "Append BoQ test",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeen",
      status: "In Progress",
      owner: "Office",
      bidValue: 100,
      tenderSum: 100,
      boqTitle: "Issued BoQ",
      boqLines: [
        {
          id: "keep-me",
          kind: "measured",
          ref: "8/1/A",
          description: "Doc M pack",
          quantity: 1,
          unit: "nr",
          rate: 1800,
          value: 1800,
          sheet: "Bill",
        },
      ],
    });

    const updated = importBoqWorkbookIntoTender(
      tender.id,
      [
        {
          name: "Supplier quote",
          rows: [
            ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
            ["SQ-1", "Extra radiator valve", "4", "nr", "25", "100"],
          ],
        },
      ],
      undefined,
      { mode: "append", appendSheetLabel: "Supplier quote" },
    );

    assert.equal(updated.boqLines.some((line) => line.id === "keep-me"), true);
    assert.equal(updated.boqLines.some((line) => line.ref === "SQ-1"), true);
    assert.ok(updated.boqLines.length >= 2);
    assert.equal(updated.boqTitle, "Issued BoQ");
  });

  it("replace import still wipes prior lines when explicitly requested", () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });
    const tender = upsertTender({
      id: "tender-boq-replace",
      name: "Replace BoQ test",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeen",
      status: "In Progress",
      owner: "Office",
      bidValue: 100,
      boqLines: [
        {
          id: "old",
          kind: "measured",
          ref: "OLD",
          description: "Old line",
          quantity: 1,
          unit: "nr",
          rate: 10,
          value: 10,
        },
      ],
    });

    const updated = importBoqIntoTender(
      tender.id,
      ["Ref,Description,Quantity,Units,Rate,Value", "NEW,New line,1,nr,50,50"].join("\n"),
      undefined,
      { mode: "replace" },
    );

    assert.equal(updated.boqLines.some((line) => line.id === "old"), false);
    assert.equal(updated.boqLines.some((line) => line.ref === "NEW"), true);
  });

  it("builds an Excel buffer and CSV-shaped rows from BoQ lines", () => {
    const lines: TenderBoqLine[] = [
      {
        id: "h1",
        kind: "header",
        description: "Sanitary",
        sheet: "Page 1",
        section: "Sanitary",
      },
      {
        id: "m1",
        kind: "measured",
        ref: "8/1/A",
        description: "Basin",
        quantity: 2,
        unit: "nr",
        rate: 50,
        value: 100,
        sheet: "Page 1",
        section: "Sanitary",
      },
      {
        id: "m2",
        kind: "measured",
        ref: "S1",
        description: "Valve",
        quantity: 1,
        unit: "nr",
        rate: 20,
        value: 20,
        sheet: "Supplier",
        section: "Supplier",
      },
    ];

    const rows = tenderBoqLinesToRows(lines.filter((line) => line.sheet === "Page 1"));
    assert.deepEqual(rows[0], ["Ref", "Description", "Quantity", "Units", "Rate", "Value", "Note"]);
    assert.equal(rows[1]?.[1], "Sanitary");
    assert.equal(rows[2]?.[0], "8/1/A");

    const buffer = buildTenderBoqXlsxBuffer(lines);
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 100);

    const activeOnly = buildTenderBoqXlsxBuffer(lines, { sheetKey: "Supplier" });
    assert.ok(activeOnly.length > 50);
  });

  it("rejects empty BoQ imports instead of silently wiping", () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });
    const tender = upsertTender({
      id: "tender-boq-empty-import",
      name: "Empty import guard",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeen",
      status: "In Progress",
      boqLines: [
        {
          id: "keep",
          kind: "measured",
          ref: "1",
          description: "Keep me",
          quantity: 1,
          unit: "nr",
          rate: 10,
          value: 10,
        },
      ],
    });
    assert.throws(
      () => importBoqIntoTender(tender.id, "Ref,Description,Quantity,Units\n", undefined, { mode: "replace" }),
      /No BoQ lines found/i,
    );
    assert.equal(getTender(tender.id)?.boqLines.some((line) => line.id === "keep"), true);
  });

  it("append sales-order workbook keeps takeoff Hot & cold pipes off the Sales Order tab", () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });
    const tender = upsertTender({
      id: "tender-so-isolate",
      name: "Sales order isolate",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeen",
      status: "In Progress",
      boqLines: [
        {
          id: "takeoff-boq-pipe-1",
          kind: "measured",
          ref: "PIPE",
          description: "15mm Copper · Cold pipe runs",
          quantity: 12,
          unit: "m",
          rate: 9.5,
          value: 114,
          note: "Lower ground · Rate library guide — amend when supplier quote lands",
          pricingSource: "rate-library",
          sheet: "Takeoff · Hot & cold",
          section: "Pipework",
        },
        {
          id: "takeoff-boq-pipe-2",
          kind: "measured",
          ref: "PIPE",
          description: "22mm Copper · Cold pipe runs",
          quantity: 8,
          unit: "m",
          rate: 12,
          value: 96,
          note: "Lower ground · Rate library guide — amend when supplier quote lands",
          pricingSource: "rate-library",
          sheet: "Takeoff · Hot & cold",
          section: "Pipework",
        },
      ],
    });

    const updated = importBoqWorkbookIntoTender(
      tender.id,
      [
        {
          name: "Sales Order 33888",
          rows: [
            ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
            ["PIPE", "15mm Copper - Cold pipe runs", "4.5", "m", "9.5", "42.75"],
            ["01", "EDP TANK, PRO 1000A3", "1", "nr", "3147.15", "3147.15"],
            ["LOWA60", "60 LTR LOWARA VERTICAL - EXPANSION VESSEL, 10 BAR", "1", "nr", "164", "164"],
            ["01", "CARRIAGE", "1", "nr", "100", "100"],
          ],
        },
      ],
      undefined,
      { mode: "append", appendSheetLabel: "Sales Order 33888" },
    );

    const tabs = listBoqSheetTabs(updated.boqLines);
    assert.ok(tabs.some((tab) => tab.key === "Takeoff · Hot & cold"));
    assert.ok(tabs.some((tab) => tab.key === "Sales Order 33888"));
    const so = updated.boqLines.filter(
      (line) => line.kind === "measured" && (line.sheet || "").trim() === "Sales Order 33888",
    );
    assert.equal(so.length, 3);
    assert.ok(so.every((line) => !/cold\s+pipe\s+runs?/i.test(line.description)));
    assert.ok(so.some((line) => /EDP TANK/i.test(line.description)));
    assert.ok(so.some((line) => /LOWARA/i.test(line.description)));
    assert.ok(so.some((line) => /CARRIAGE/i.test(line.description)));
    assert.ok(
      updated.boqLines.some(
        (line) =>
          line.id === "takeoff-boq-pipe-1" && (line.sheet || "").trim() === "Takeoff · Hot & cold",
      ),
    );
  });

  it("paste append stamps Additional items — not the active Sales Order tab name", () => {
    writeServerStore("nexa-tenders-v1", { tenders: [] });
    const tender = upsertTender({
      id: "tender-paste-isolate",
      name: "Paste isolate",
      client: "Burns",
      category: "Plumbing",
      area: "Aberdeen",
      status: "In Progress",
      boqLines: [
        {
          id: "so-1",
          kind: "measured",
          ref: "01",
          description: "CARRIAGE",
          quantity: 1,
          unit: "nr",
          rate: 100,
          value: 100,
          sheet: "Sales Order 33888",
        },
      ],
    });

    const updated = importBoqIntoTender(
      tender.id,
      [
        "Ref,Description,Quantity,Units,Rate,Notes",
        "PIPE,15mm Copper - Cold pipe runs,12,m,9.5,Lower ground · Rate library guide",
      ].join("\n"),
      undefined,
      { mode: "append", appendSheetLabel: "Additional items" },
    );

    const so = updated.boqLines.filter(
      (line) => (line.sheet || "").trim() === "Sales Order 33888" && line.kind === "measured",
    );
    assert.equal(so.length, 1);
    assert.equal(so[0]?.description, "CARRIAGE");
    assert.ok(
      updated.boqLines.some(
        (line) =>
          /Cold pipe runs/i.test(line.description) &&
          (line.sheet || "").trim() === "Additional items",
      ),
    );
  });

  it("adds, renames, and removes sheet tabs plus manual lines", () => {
    writeServerStore("tenders.json", { tenders: [] });
    const tender = upsertTender({
      id: "tender-boq-edit",
      name: "Edit BoQ test",
      client: "Test Client",
      category: "Plumbing",
      area: "Aberdeen",
      status: "In Progress",
      boqLines: [
        {
          id: "keep",
          kind: "measured",
          ref: "1/A",
          description: "Basin",
          quantity: 1,
          unit: "nr",
          rate: 50,
          value: 50,
        },
      ],
    });

    const withSheet = addBoqSheetTab(tender.id, "Supplier quote");
    assert.equal(withSheet.sheetKey, "Supplier quote");
    const tabsAfterAdd = listBoqSheetTabs(withSheet.tender.boqLines);
    assert.ok(tabsAfterAdd.some((tab) => tab.key === "Issued BoQ"));
    assert.ok(tabsAfterAdd.some((tab) => tab.key === "Supplier quote"));

    const withLine = addBoqMeasuredLine(tender.id, {
      sheet: "Supplier quote",
      ref: "SQ-1",
      description: "Valve",
      quantity: 2,
      unit: "nr",
    });
    const added = withLine.boqLines.find((line) => line.ref === "SQ-1");
    assert.ok(added);
    assert.equal(added?.sheet, "Supplier quote");

    const renamed = renameBoqSheetTab(tender.id, "Supplier quote", "Heating pack");
    assert.equal(renamed.sheetKey, "Heating pack");
    assert.ok(renamed.tender.boqLines.every((line) => line.sheet !== "Supplier quote"));
    assert.ok(renamed.tender.boqLines.some((line) => line.ref === "SQ-1" && line.sheet === "Heating pack"));

    const afterDeleteLine = deleteBoqLines(tender.id, [added!.id]);
    assert.equal(afterDeleteLine.boqLines.some((line) => line.ref === "SQ-1"), false);

    const clearedSheet = deleteBoqSheetTab(tender.id, "Heating pack");
    assert.equal(
      listBoqSheetTabs(clearedSheet.boqLines).some((tab) => tab.key === "Heating pack"),
      false,
    );
    assert.ok(clearedSheet.boqLines.some((line) => line.id === "keep"));
  });
});
