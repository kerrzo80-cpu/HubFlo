import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before } from "node:test";

const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-takeoff-learning-"));
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";

let applyLearningToMeasuredRows: typeof import("./takeoff-learning-store").applyLearningToMeasuredRows;
let getTakeoffLearningStore: typeof import("./takeoff-learning-store").getTakeoffLearningStore;
let recordTakeoffLearningEvent: typeof import("./takeoff-learning-store").recordTakeoffLearningEvent;
let takeoffLearningPreferences: typeof import("./takeoff-learning-store").takeoffLearningPreferences;

before(async () => {
  const mod = await import("./takeoff-learning-store");
  applyLearningToMeasuredRows = mod.applyLearningToMeasuredRows;
  getTakeoffLearningStore = mod.getTakeoffLearningStore;
  recordTakeoffLearningEvent = mod.recordTakeoffLearningEvent;
  takeoffLearningPreferences = mod.takeoffLearningPreferences;
});

describe("takeoff learning habits", () => {
  it("learns preferred pipe size and trade from repeated choices", () => {
    recordTakeoffLearningEvent({
      type: "pipe_spec_choice",
      pipeSpecId: "cu-22",
      trade: "plumbing",
    });
    recordTakeoffLearningEvent({
      type: "pipe_spec_choice",
      pipeSpecId: "cu-22",
      trade: "plumbing",
    });
    recordTakeoffLearningEvent({
      type: "manual_linear",
      pipeSpecId: "cu-15",
      trade: "plumbing",
      codes: ["Cold pipe runs"],
    });

    const prefs = takeoffLearningPreferences();
    assert.equal(prefs.defaultPipeSpecId, "cu-22");
    assert.equal(prefs.defaultTrade, "plumbing");
    assert.ok(prefs.eventCount >= 3);
    assert.match(prefs.summary, /Blake is learning/i);
  });

  it("treats rejects as avoid-codes, not keeps", () => {
    recordTakeoffLearningEvent({
      type: "ai_reject",
      codes: ["P-WC"],
      trade: "plumbing",
    });
    recordTakeoffLearningEvent({
      type: "ai_reject",
      codes: ["P-WC"],
      trade: "plumbing",
    });
    recordTakeoffLearningEvent({
      type: "ai_confirm",
      codes: ["P-WHB", "P-PIPE-C"],
      trade: "plumbing",
    });

    const store = getTakeoffLearningStore();
    assert.equal(store.confirmedCodeCounts["P-WC"] || 0, 0);
    assert.ok((store.rejectedCodeCounts["P-WC"] || 0) >= 2);
    assert.ok((store.confirmedCodeCounts["P-WHB"] || 0) >= 1);

    const ranked = applyLearningToMeasuredRows(
      [
        { code: "P-WC", confidence: "High", notes: "" },
        { code: "P-WHB", confidence: "Medium", notes: "" },
        { code: "P-RAD", confidence: "Medium", notes: "" },
      ],
      takeoffLearningPreferences(),
    );
    assert.equal(ranked[0]?.code, "P-WHB");
    assert.equal(ranked.find((row) => row.code === "P-WC")?.confidence, "Low");
  });

  it("records scale choices", () => {
    recordTakeoffLearningEvent({ type: "scale_choice", scaleLabel: "1:50", trade: "plumbing" });
    recordTakeoffLearningEvent({ type: "scale_choice", scaleLabel: "1:50", trade: "plumbing" });
    const prefs = takeoffLearningPreferences();
    assert.equal(prefs.preferredScaleLabel, "1:50");
  });
});
