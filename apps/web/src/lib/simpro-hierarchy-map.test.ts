import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blockTimes,
  mapSimproInvoice,
  mapSimproJobCostCentres,
  mapSimproJobSchedules,
  mapSimproQuoteCostCentres,
  scheduleBelongsToSimproJob,
  summariseHierarchyStats,
} from "@/lib/simpro-hierarchy-map";

const sampleJob = {
  ID: 210787,
  Type: "Project",
  Sections: [
    {
      ID: 10922,
      Name: "First fix",
      DisplayOrder: 1,
      CostCenters: [
        {
          ID: 12006,
          Name: "Bathroom first fix",
          CostCenter: { ID: 3, Name: "Plumbing" },
          Description: "Hot and cold first fix",
          Items: {
            Labors: [
              {
                ID: 3682,
                LaborType: { ID: 2, Name: "Plumber" },
                LaborRate: 35,
                SellPrice: { ExTax: 55 },
                Total: { Qty: 8, Amount: { ExTax: 440 } },
              },
            ],
            Catalogs: [
              {
                ID: 901,
                Catalogue: { ID: 55, Name: "15mm copper tube" },
                CostPrice: { ExTax: 2.4 },
                SellPrice: { ExTax: 3.6 },
                Total: { Qty: 25, Amount: { ExTax: 90 } },
              },
            ],
            OneOffs: [
              {
                ID: 77,
                Name: "Site consumables",
                Type: "Material",
                CostPrice: 40,
                SellPrice: 60,
                Total: { Qty: 1, Amount: { ExTax: 60 } },
              },
            ],
            Prebuilds: [],
            ServiceFees: [],
          },
        },
      ],
    },
  ],
};

describe("simpro hierarchy map", () => {
  it("maps quote cost centres with labour and materials into lines", () => {
    const { centres, stats } = mapSimproQuoteCostCentres(sampleJob, "quote-1");
    assert.equal(centres.length, 1);
    assert.equal(centres[0]?.name, "Bathroom first fix");
    assert.equal(centres[0]?.sectionName, "First fix");
    assert.equal(centres[0]?.lines.length, 3);
    assert.ok(centres[0]?.lines.some((line) => line.description === "Plumber" && line.quantity === 8));
    assert.ok(centres[0]?.lines.some((line) => line.description === "15mm copper tube" && line.quantity === 25));
    assert.equal(stats.labourLines, 1);
    assert.equal(stats.materialLines, 2);
    assert.match(summariseHierarchyStats(stats), /1 cost centre/);
  });

  it("maps root-level CostCenters when Sections is missing", () => {
    const { centres, stats } = mapSimproQuoteCostCentres(
      {
        ID: 55,
        Name: "Root CC quote",
        CostCenters: [
          {
            ID: 9,
            Name: "Boiler works",
            Items: {
              Catalogues: [{ ID: 1, Catalogue: { Name: "Boiler" }, Total: { Qty: 1, Amount: { ExTax: 900 } }, SellPrice: { ExTax: 900 } }],
            },
          },
        ],
      },
      "quote-root",
    );
    assert.equal(stats.sections, 1);
    assert.equal(centres.length, 1);
    assert.equal(centres[0]?.name, "Boiler works");
  });

  it("maps British CostCentres spelling on quote sections", () => {
    const { centres, stats } = mapSimproQuoteCostCentres(
      {
        ID: 99,
        Sections: [
          {
            ID: 1,
            Name: "Main",
            CostCentres: [
              {
                ID: 7,
                Name: "Heating",
                Description: "Boiler swap",
                Items: {
                  Catalogues: [
                    {
                      ID: 1,
                      Catalogue: { Name: "Boiler" },
                      Total: { Qty: 1, Amount: { ExTax: 1200 } },
                      SellPrice: { ExTax: 1200 },
                      CostPrice: { ExTax: 900 },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      "quote-uk",
    );
    assert.equal(stats.costCentres, 1);
    assert.equal(centres[0]?.name, "Heating");
    assert.equal(centres[0]?.lines.length, 1);
  });

  it("maps job cost centres into separate materials and labour arrays", () => {
    const { centres, stats } = mapSimproJobCostCentres(sampleJob, "job-9");
    assert.equal(centres.length, 1);
    assert.equal(centres[0]?.labour.length, 1);
    assert.equal(centres[0]?.materials.length, 2);
    assert.equal(centres[0]?.labour[0]?.role, "Plumber");
    assert.equal(centres[0]?.labour[0]?.hours, 8);
    assert.equal(centres[0]?.labour[0]?.costRate, 35);
    assert.equal(centres[0]?.materials[0]?.description, "15mm copper tube");
    assert.equal(stats.costCentres, 1);
  });

  it("maps schedules onto the matching cost centre via Reference", () => {
    const { centres } = mapSimproJobCostCentres(sampleJob, "job-9");
    const assignments = mapSimproJobSchedules(
      [
        {
          ID: 501,
          Type: "job",
          Reference: "210787-12006",
          TotalHours: 8,
          Staff: { ID: 12, Name: "Alex Plumber" },
          Date: "2026-08-05",
          Blocks: [{ Hrs: 8, StartTime: "08:00", EndTime: "16:00" }],
          Notes: "First fix day",
        },
      ],
      "job-9",
      centres,
    );
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0]?.employeeName, "Alex Plumber");
    assert.equal(assignments[0]?.costCentreId, centres[0]?.id);
    assert.equal(assignments[0]?.startDate, "2026-08-05");
    assert.equal(assignments[0]?.plannedHours, 8);
  });

  it("matches schedule rows to a job without short-id false positives", () => {
    assert.equal(scheduleBelongsToSimproJob({ Reference: "210787-12006" }, "210787"), true);
    assert.equal(scheduleBelongsToSimproJob({ Reference: "210787-12006" }, "21"), false);
    assert.equal(scheduleBelongsToSimproJob({ JobID: 210787 }, "210787"), true);
    assert.equal(scheduleBelongsToSimproJob({ Reference: "210787" }, "210787"), true);
  });

  it("parses ISO block times and numeric Staff ids", () => {
    const times = blockTimes([
      { Hrs: 4, ISO8601StartTime: "2026-08-05T08:00:00+01:00", ISO8601EndTime: "2026-08-05T12:00:00+01:00" },
    ]);
    assert.equal(times.startTime, "08:00");
    assert.equal(times.endTime, "12:00");

    const assignments = mapSimproJobSchedules(
      [
        {
          ID: 77,
          Reference: "9-1",
          Date: "2026-08-06",
          Staff: 44,
          Blocks: [{ StartTime: "09:00", EndTime: "11:00", Hrs: 2 }],
        },
      ],
      "job-x",
      [],
    );
    assert.equal(assignments[0]?.employeeId, "simpro-staff-44");
    assert.equal(assignments[0]?.startTime, "09:00");
  });

  it("splits client and engineer descriptions from simPRO cost centre Description", () => {
    const { centres } = mapSimproQuoteCostCentres(
      {
        ID: 1,
        Sections: [
          {
            ID: 2,
            Name: "Works",
            CostCenters: [
              {
                ID: 3,
                Name: "Bathroom first fix",
                CostCenter: { ID: 3, Name: "Plumbing" },
                Description:
                  "Bathroom first fix\n\nClient: strip out and first fix hot/cold.\n\nEngineer: isolate, run pipework, pressure test.",
              },
            ],
          },
        ],
      },
      "quote-desc",
    );
    assert.equal(centres[0]?.name, "Bathroom first fix");
    assert.match(centres[0]?.clientDescription || "", /Client: strip out/);
    assert.match(centres[0]?.engineerDescription || "", /Engineer: isolate/);
  });

  it("keeps simPRO sell when present and applies Blake markup only when sell is missing", () => {
    const { centres } = mapSimproQuoteCostCentres(
      {
        ID: 1,
        Sections: [
          {
            ID: 2,
            Name: "Works",
            CostCenters: [
              {
                ID: 3,
                Name: "Materials",
                Items: {
                  Catalogs: [
                    {
                      ID: 10,
                      Catalogue: { ID: 55, Name: "Copper", BasePrice: { ExTax: 2 } },
                      BasePrice: 2,
                      Markup: 50,
                      SellPrice: { ExTax: 3 },
                      Total: { Qty: 10, Amount: { ExTax: 30 } },
                    },
                    {
                      ID: 11,
                      Catalogue: { Name: "Fitting" },
                      Markup: 25,
                      SellPrice: { ExTax: 10 },
                      Total: { Qty: 1, Amount: { ExTax: 10 } },
                    },
                    {
                      ID: 13,
                      Catalogue: { Name: "Valve" },
                      BasePrice: 20,
                      Total: { Qty: 1 },
                    },
                  ],
                  Labors: [
                    {
                      ID: 12,
                      LaborType: { Name: "Plumber", CostRate: 35 },
                      LaborRate: 35,
                      SellPrice: { ExTax: 55 },
                      Total: { Qty: 2, Amount: { ExTax: 110 } },
                    },
                  ],
                  OneOffs: [],
                  Prebuilds: [],
                  ServiceFees: [],
                },
              },
            ],
          },
        ],
      },
      "quote-cost-price",
      { materialMarkupPercent: 30, labourMarkupPercent: 30 },
    );
    const copper = centres[0]?.lines.find((line) => line.description === "Copper");
    const fitting = centres[0]?.lines.find((line) => line.description === "Fitting");
    const valve = centres[0]?.lines.find((line) => line.description === "Valve");
    const labour = centres[0]?.lines.find((line) => line.description === "Plumber");
    assert.equal(copper?.unitCost, 2);
    assert.equal(copper?.unitSell, 3); // keep simPRO charge
    assert.equal(fitting?.unitCost, 8); // reverse from simPRO sell/markup when BasePrice missing
    assert.equal(fitting?.unitSell, 10);
    assert.equal(valve?.unitCost, 20);
    assert.equal(valve?.unitSell, 26); // no sell → Blake 30% markup
    assert.equal(labour?.unitCost, 35);
    assert.equal(labour?.unitSell, 55);
  });

  it("rejects mirrored CostPrice===SellPrice and backs out cost via Blake markup", () => {
    const { centres } = mapSimproQuoteCostCentres(
      {
        ID: 1,
        Sections: [
          {
            ID: 2,
            Name: "Works",
            CostCenters: [
              {
                ID: 3,
                Name: "Materials",
                Items: {
                  Catalogs: [
                    {
                      ID: 50,
                      Catalogue: { Name: "Bath panel" },
                      // Tenant mirrored sell into CostPrice — must not become unitCost.
                      CostPrice: { ExTax: 120 },
                      SellPrice: { ExTax: 120 },
                      Total: { Qty: 1, Amount: { ExTax: 120 } },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      "quote-mirrored-cost",
      { materialMarkupPercent: 30, labourMarkupPercent: 30 },
    );
    const line = centres[0]?.lines[0];
    assert.equal(line?.unitSell, 120);
    assert.equal(line?.unitCost, Math.round((120 / 1.3) * 100) / 100);
    assert.notEqual(line?.unitCost, line?.unitSell);
  });

  it("prefers Catalogue.BasePrice over CostPrice that mirrors sell", () => {
    const { centres } = mapSimproQuoteCostCentres(
      {
        ID: 1,
        Sections: [
          {
            ID: 2,
            Name: "Works",
            CostCenters: [
              {
                ID: 3,
                Name: "Materials",
                Items: {
                  Catalogs: [
                    {
                      ID: 51,
                      Catalogue: { Name: "Shower screen", BasePrice: { ExTax: 80 } },
                      CostPrice: { ExTax: 160 },
                      SellPrice: { ExTax: 160 },
                      Total: { Qty: 1, Amount: { ExTax: 160 } },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      "quote-base-over-cost",
    );
    const line = centres[0]?.lines[0];
    assert.equal(line?.unitCost, 80);
    assert.equal(line?.unitSell, 160);
  });

  it("backs out cost from sell via Blake markup when BasePrice is missing", () => {
    const { centres } = mapSimproQuoteCostCentres(
      {
        ID: 1,
        Sections: [
          {
            ID: 2,
            Name: "Works",
            CostCenters: [
              {
                ID: 3,
                Name: "Materials",
                Items: {
                  Catalogs: [
                    {
                      ID: 99,
                      Catalogue: { Name: "Unknown part" },
                      SellPrice: { ExTax: 40 },
                      Total: { Qty: 1, Amount: { ExTax: 40 } },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      "quote-sell-only",
      { materialMarkupPercent: 30, labourMarkupPercent: 30 },
    );
    const line = centres[0]?.lines[0];
    // No BasePrice — back out cost from sell using Blake default markup so cost ≠ charge.
    assert.equal(line?.unitSell, 40);
    assert.equal(line?.unitCost, Math.round((40 / 1.3) * 100) / 100);
  });

  it("maps invoices with line totals and job linkage", () => {
    const mapped = mapSimproInvoice({
      ID: 88,
      InvoiceNo: "INV-8801",
      Status: { Name: "Sent" },
      Customer: { CompanyName: "Morrison & Co." },
      Job: { ID: 210787 },
      DateIssued: "2026-07-01",
      DateDue: "2026-07-15",
      Total: { ExTax: 590 },
      Items: [
        {
          ID: 1,
          Name: "Materials",
          Type: "Material",
          CostPrice: 200,
          SellPrice: 300,
          Total: { Qty: 1, Amount: { ExTax: 300 } },
        },
        {
          ID: 2,
          LaborType: { Name: "Plumber" },
          LaborRate: 35,
          SellPrice: { ExTax: 55 },
          Total: { Qty: 4, Amount: { ExTax: 220 } },
        },
      ],
    });
    assert.ok(mapped);
    assert.equal(mapped?.externalNumber, "INV-8801");
    assert.equal(mapped?.status, "Sent");
    assert.equal(mapped?.simproJobId, "210787");
    assert.equal(mapped?.lines.length, 2);
    assert.equal(mapped?.lines[1]?.category, "Labour");
    assert.equal(mapped?.chargeTotal, 590);
  });

  it("maps simPRO Created/unpaid invoices to Sent so folders can use due date", () => {
    const mapped = mapSimproInvoice({
      ID: 99,
      InvoiceNo: "INV-9901",
      Status: { Name: "Invoices : Created" },
      Stage: "Approved",
      IsPaid: false,
      Customer: { CompanyName: "Aberbuild" },
      DateIssued: "2026-06-01",
      DateDue: "2026-06-15",
      Total: { ExTax: 1200 },
      Items: [],
    });
    assert.ok(mapped);
    assert.equal(mapped?.status, "Sent");
  });
});
