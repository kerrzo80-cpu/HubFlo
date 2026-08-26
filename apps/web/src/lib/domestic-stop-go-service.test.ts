import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { advanceRun, getRunDto, saveRunAnswers, startWorkflowRun } from "@/lib/domestic-stop-go/service";
import { GAS_SERVICE_TRIAL, ensureDomesticStopGoSeed } from "@/lib/domestic-stop-go/seed";
import { findEmployeeCard } from "@/lib/domestic-stop-go/prefill";
import { getPublishedTemplate } from "@/lib/domestic-stop-go/templates";

function answerValue(answers: Array<{ fieldKey: string; value: unknown }>, fieldKey: string) {
  return answers.find((item) => item.fieldKey === fieldKey)?.value;
}

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

  it("prefills attendance from the diary, client and employee card, and keeps actual time editable", () => {
    ensureDomesticStopGoSeed({ testFixtures: true });
    const dateField = getPublishedTemplate("DOM_GAS_BOILER_SERVICE")?.fields.find((item) => item.fieldKey === "attendance.attendance_date");
    const timeField = getPublishedTemplate("DOM_GAS_BOILER_SERVICE")?.fields.find((item) => item.fieldKey === "attendance.arrival_time");
    assert.equal(dateField?.systemPopulated, undefined);
    assert.equal(timeField?.systemPopulated, undefined);

    const started = startWorkflowRun({
      jobId: GAS_SERVICE_TRIAL.jobId,
      jobCostCentreId: `${GAS_SERVICE_TRIAL.costCentreId}-prefill-${Date.now()}`,
      costCentreCodeOrName: "DOM_GAS_BOILER_SERVICE",
      actorId: "eng-chris",
      actorName: "Chris Lawson",
      scheduleId: GAS_SERVICE_TRIAL.scheduleId,
    });
    const card = findEmployeeCard("eng-chris", "Chris Lawson");
    assert.equal(answerValue(started.answers, "attendance.customer_name"), GAS_SERVICE_TRIAL.customer);
    assert.match(String(answerValue(started.answers, "attendance.customer_contact") || ""), /1423/);
    assert.equal(answerValue(started.answers, "attendance.gas_safe_number"), GAS_SERVICE_TRIAL.gasSafeNumber);
    assert.equal(answerValue(started.answers, "attendance.engineer_id"), card?.id || GAS_SERVICE_TRIAL.engineerId);
    assert.equal(answerValue(started.answers, "attendance.work_requested"), GAS_SERVICE_TRIAL.costCentreName);
    assert.equal(answerValue(started.answers, "attendance.arrival_time"), "13:00");
    assert.ok(String(answerValue(started.answers, "attendance.attendance_date") || "").match(/^\d{4}-\d{2}-\d{2}$/));

    const edited = saveRunAnswers(
      started.run.id,
      [{ fieldKey: "attendance.attendance_date", value: "2026-09-02" }, { fieldKey: "attendance.arrival_time", value: "14:30" }],
      "eng-chris",
    );
    assert.equal(answerValue(edited.answers, "attendance.attendance_date"), "2026-09-02");
    assert.equal(answerValue(edited.answers, "attendance.arrival_time"), "14:30");

    const hydrated = getRunDto(started.run.id);
    assert.equal(answerValue(hydrated.answers, "attendance.attendance_date"), "2026-09-02");
    assert.equal(answerValue(hydrated.answers, "attendance.arrival_time"), "14:30");
    assert.equal(answerValue(hydrated.answers, "attendance.customer_name"), GAS_SERVICE_TRIAL.customer);
  });

  it("backfills empty customer fields on an existing run without overwriting actual attendance", () => {
    ensureDomesticStopGoSeed({ testFixtures: true });
    const started = startWorkflowRun({
      jobId: GAS_SERVICE_TRIAL.jobId,
      jobCostCentreId: `${GAS_SERVICE_TRIAL.costCentreId}-hydrate-${Date.now()}`,
      costCentreCodeOrName: "DOM_GAS_BOILER_SERVICE",
      actorId: "eng-chris",
      actorName: "Chris Lawson",
      scheduleId: GAS_SERVICE_TRIAL.scheduleId,
    });
    saveRunAnswers(
      started.run.id,
      [
        { fieldKey: "attendance.customer_name", value: "" },
        { fieldKey: "attendance.gas_safe_number", value: "" },
        { fieldKey: "attendance.attendance_date", value: "2026-08-20" },
      ],
      "eng-chris",
    );
    const hydrated = getRunDto(started.run.id);
    assert.equal(answerValue(hydrated.answers, "attendance.customer_name"), GAS_SERVICE_TRIAL.customer);
    assert.equal(answerValue(hydrated.answers, "attendance.gas_safe_number"), GAS_SERVICE_TRIAL.gasSafeNumber);
    assert.equal(answerValue(hydrated.answers, "attendance.attendance_date"), "2026-08-20");
  });
});
