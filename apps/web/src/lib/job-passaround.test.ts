import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const storeDir = mkdtempSync(path.join(tmpdir(), "passaround-"));
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";

describe("atomic job passaround", () => {
  let jobId = "";
  let createJob: typeof import("./workflow-data").createJob;
  let getJob: typeof import("./workflow-data").getJob;
  let updateJob: typeof import("./workflow-data").updateJob;
  let completeJobPassaround: typeof import("./job-passaround").completeJobPassaround;
  let forceJobReviewsComplete: typeof import("./job-passaround").forceJobReviewsComplete;
  let readJobInvoiceReview: typeof import("./job-passaround").readJobInvoiceReview;
  let readyJobForInvoice: typeof import("./job-passaround").readyJobForInvoice;
  let setJobReviewTick: typeof import("./job-passaround").setJobReviewTick;
  let jobInvoiceReviewComplete: typeof import("./job-invoice-review").jobInvoiceReviewComplete;
  let getHubDetailState: typeof import("./hub-detail-store").getHubDetailState;

  before(async () => {
    ({ createJob, getJob, updateJob } = await import("./workflow-data"));
    ({
      completeJobPassaround,
      forceJobReviewsComplete,
      readJobInvoiceReview,
      readyJobForInvoice,
      setJobReviewTick,
    } = await import("./job-passaround"));
    ({ jobInvoiceReviewComplete } = await import("./job-invoice-review"));
    ({ getHubDetailState } = await import("./hub-detail-store"));

    const job = createJob({
      customer: "Test Client",
      description: "Passaround test",
      due: "2026-09-01",
      status: "In progress",
      manager: "Alex",
      scheduledDate: "2026-08-20",
      scheduledTime: "09:00",
      scheduledDurationHours: 8,
      next: "Do the work",
      site: "1 Test Street",
    });
    jobId = job.id;
    // Seed a diary clash twin — status moves must still succeed.
    createJob({
      customer: "Clash Client",
      description: "Overlapping diary",
      due: "2026-09-01",
      status: "In progress",
      manager: "Alex",
      scheduledDate: "2026-08-20",
      scheduledTime: "10:00",
      scheduledDurationHours: 8,
      next: "Clash",
      site: "2 Test Street",
    });
  });

  after(() => {
    try {
      rmSync(storeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("ticks reviews and completes despite overlapping diary", () => {
    setJobReviewTick(jobId, "construction", true);
    setJobReviewTick(jobId, "commercial", true);
    const review = setJobReviewTick(jobId, "office", true);
    assert.equal(jobInvoiceReviewComplete(review), true);

    const completed = completeJobPassaround(jobId, "Tester");
    assert.equal(completed.status, "Completed");
    assert.equal(getJob(jobId)?.status, "Completed");
  });

  it("ready-to-invoice forces reviews and moves status atomically", () => {
    updateJob(jobId, { status: "Completed", next: "Pass around" });
    forceJobReviewsComplete(jobId);
    setJobReviewTick(jobId, "office", false);
    assert.equal(jobInvoiceReviewComplete(readJobInvoiceReview(jobId)), false);

    const result = readyJobForInvoice(jobId, "Tester");
    assert.equal(result.job.status, "Ready to invoice");
    assert.equal(jobInvoiceReviewComplete(result.review), true);
    assert.equal(jobInvoiceReviewComplete(readJobInvoiceReview(jobId)), true);
    assert.equal(jobInvoiceReviewComplete(getHubDetailState().jobReviews?.[jobId]), true);
    assert.equal(getJob(jobId)?.status, "Ready to invoice");
  });

  it("review ticks persist through lean side store without wiping hub", () => {
    setJobReviewTick(jobId, "construction", true);
    setJobReviewTick(jobId, "commercial", false);
    const review = readJobInvoiceReview(jobId);
    assert.equal(review.construction, true);
    assert.equal(review.commercial, false);
    // Full hub read must still see the tick (side-store overlay).
    const fromHub = getHubDetailState().jobReviews?.[jobId] as { construction?: boolean } | undefined;
    assert.equal(fromHub?.construction, true);
  });
});
