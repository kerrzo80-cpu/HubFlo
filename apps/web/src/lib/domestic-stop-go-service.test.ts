import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { advanceRun, saveRunAnswers, startWorkflowRun } from "@/lib/domestic-stop-go/service";
import { GAS_SERVICE_TRIAL } from "@/lib/domestic-stop-go/seed";

describe("domestic stop/go run engine", () => {
  it("starts a gas boiler service run and refuses to advance an empty attendance gate", () => {
    const started = startWorkflowRun({
      jobId: GAS_SERVICE_TRIAL.jobId,
      jobCostCentreId: `${GAS_SERVICE_TRIAL.costCentreId}-test-${Date.now()}`,
      costCentreCodeOrName: "DOM_GAS_BOILER_SERVICE",
      actorId: "eng-chris",
      actorName: "Chris Lawson",
      scheduleId: GAS_SERVICE_TRIAL.scheduleId,
    });
    assert.equal(started.run.costCentreCode, "DOM_GAS_BOILER_SERVICE");
    assert.equal(started.run.status === "complete", false);
    assert.equal(started.canAdvance, false);
    assert.throws(
      () => advanceRun(started.run.id, "eng-chris"),
      /before continuing|required|Confirm|domestic|competency/i,
    );
  });

  it("blocks start when the engineer lacks a current competency", () => {
    assert.throws(
      () =>
        startWorkflowRun({
          jobId: "job-no-comp",
          jobCostCentreId: `cc-no-comp-${Date.now()}`,
          costCentreCodeOrName: "DOM_GAS_BOILER_SERVICE",
          actorId: "eng-unknown",
        }),
      /competency/i,
    );
  });

  it("autosave keeps zero and not-tested distinct", () => {
    const started = startWorkflowRun({
      jobId: GAS_SERVICE_TRIAL.jobId,
      jobCostCentreId: `${GAS_SERVICE_TRIAL.costCentreId}-status-${Date.now()}`,
      costCentreCodeOrName: "Gas Boiler Service",
      actorId: "eng-chris",
    });
    const saved = saveRunAnswers(
      started.run.id,
      [
        { fieldKey: "pre.standing_pressure", value: 0, answerStatus: "answered" },
        { fieldKey: "pre.gas_rate", value: "", answerStatus: "not_tested", reason: "Meter inaccessible" },
      ],
      "eng-chris",
    );
    const zero = saved.answers.find((item) => item.fieldKey === "pre.standing_pressure");
    const skipped = saved.answers.find((item) => item.fieldKey === "pre.gas_rate");
    assert.equal(zero?.value, 0);
    assert.equal(zero?.answerStatus, "answered");
    assert.equal(skipped?.answerStatus, "not_tested");
    assert.equal(skipped?.reason, "Meter inaccessible");
  });
});
