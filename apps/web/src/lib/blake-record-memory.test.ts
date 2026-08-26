import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before } from "node:test";

const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-blake-record-"));
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";

let appendBlakeRecordMessages: typeof import("./blake-record-memory").appendBlakeRecordMessages;
let blakeRecordKey: typeof import("./blake-record-memory").blakeRecordKey;
let getBlakeRecordMemory: typeof import("./blake-record-memory").getBlakeRecordMemory;
let recordBlakeRejectedCodes: typeof import("./blake-record-memory").recordBlakeRejectedCodes;
let applyLearningToMeasuredRows: typeof import("./takeoff-learning-store").applyLearningToMeasuredRows;
let recordTakeoffLearningEvent: typeof import("./takeoff-learning-store").recordTakeoffLearningEvent;
let takeoffLearningPreferences: typeof import("./takeoff-learning-store").takeoffLearningPreferences;
let filterFixtureRows: typeof import("./blake-trade-scope").filterFixtureRows;

before(async () => {
  const memory = await import("./blake-record-memory");
  appendBlakeRecordMessages = memory.appendBlakeRecordMessages;
  blakeRecordKey = memory.blakeRecordKey;
  getBlakeRecordMemory = memory.getBlakeRecordMemory;
  recordBlakeRejectedCodes = memory.recordBlakeRejectedCodes;
  const learning = await import("./takeoff-learning-store");
  applyLearningToMeasuredRows = learning.applyLearningToMeasuredRows;
  recordTakeoffLearningEvent = learning.recordTakeoffLearningEvent;
  takeoffLearningPreferences = learning.takeoffLearningPreferences;
  ({ filterFixtureRows } = await import("./blake-trade-scope"));
});

describe("Blake record chat + reject persistence", () => {
  it("stores a chat round-trip on the takeoff record", () => {
    const key = blakeRecordKey("takeoff", "to-chat-roundtrip");
    appendBlakeRecordMessages(key, [
      { role: "user", text: "ignore electrical — we don’t do ventilation" },
    ]);
    appendBlakeRecordMessages(key, [
      { role: "assistant", text: "Understood. Next scan is pipework and sanitary only." },
    ]);
    const stored = getBlakeRecordMemory(key);
    assert.equal(stored.messages.length, 2);
    assert.equal(stored.messages[0]?.role, "user");
    assert.match(stored.messages[0]?.text || "", /ignore electrical/i);
    assert.equal(stored.messages[1]?.role, "assistant");
    assert.match(stored.messages[1]?.text || "", /pipework/i);
  });

  it("does not re-propose a rejected class on the next propose", () => {
    const key = blakeRecordKey("takeoff", "to-reject-persist");
    recordBlakeRejectedCodes(key, ["E-SWITCH", "E-LIGHT", "light switch"]);
    recordTakeoffLearningEvent({
      type: "ai_reject",
      projectId: "to-reject-persist",
      codes: ["E-SWITCH", "E-LIGHT"],
      rejectedCodes: ["E-SWITCH", "E-LIGHT"],
      trade: "plumbing",
    });
    const memory = getBlakeRecordMemory(key);
    const nextPropose = filterFixtureRows(
      [
        { code: "E-SWITCH", description: "Light switch" },
        { code: "E-LIGHT", description: "Pendant" },
        { code: "P-WC", description: "WC" },
      ],
      { layerId: "hot-cold", rejectedCodes: memory.rejectedCodes },
    );
    assert.deepEqual(
      nextPropose.map((row) => row.code),
      ["P-WC"],
    );

    const ranked = applyLearningToMeasuredRows(
      [
        { code: "E-LIGHT", confidence: "High" as const, notes: "" },
        { code: "P-WC", confidence: "Medium" as const, notes: "" },
      ],
      takeoffLearningPreferences(),
      memory.rejectedCodes,
    );
    assert.ok(!ranked.some((row) => row.code === "E-LIGHT"));
    assert.equal(ranked[0]?.code, "P-WC");
  });
});
