import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { createDomesticWorkRecordPdf } from "@/lib/domestic-stop-go/pdf";
import { getPublishedTemplate } from "@/lib/domestic-stop-go/templates";

test("gas boiler service PDF is generated from the locked snapshot", async () => {
  const template = getPublishedTemplate("DOM_GAS_BOILER_SERVICE");
  assert.ok(template);
  const pdf = await createDomesticWorkRecordPdf({
    record: {
      id: "rec-test",
      runId: "run-test",
      tenantId: "pilot-ewg",
      jobId: "job-dom-gas-service-trial",
      recordType: template.recordTitle,
      recordNumber: "NEXA-WR-1001",
      dataSnapshot: {
        answers: {
          "service.make": { value: "Worcester", answerStatus: "answered" },
          "post.reading.co_ppm": { value: 18, answerStatus: "answered" },
          "strip.burner_hx": { value: "na", answerStatus: "not_applicable", reason: "Sealed unit" },
        },
        signatures: [{ role: "engineer", signerName: "Chris Lawson", status: "signed" }],
      },
      schemaVersion: 1,
      generatedAt: "2026-08-17T08:00:00.000Z",
      lockedAt: "2026-08-17T08:00:00.000Z",
      verificationCode: "ABC123DEF456",
    },
    template,
    jobRef: "J-TRIAL-GS",
    customer: "Hillside domestic gas service",
    site: "22 Beech Grove, Harrogate, HG1 5AA",
  });
  assert.ok(pdf.length > 200);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const loaded = await PDFDocument.load(pdf);
  assert.ok(loaded.getPageCount() >= 1);
  assert.equal(template.recordTitle, "Gas Boiler Service Record");
});
