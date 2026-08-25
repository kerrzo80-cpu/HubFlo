import assert from "node:assert/strict";
import test, { before } from "node:test";

process.env.NEXA_STORE_DIR = process.env.NEXA_STORE_DIR || "";
process.env.NEXA_STORE_PATH = process.env.NEXA_STORE_PATH || "";

let resetBlakeTrainerStoreForTests: typeof import("./store.ts").resetBlakeTrainerStoreForTests;
let listFlows: typeof import("./store.ts").listFlows;
let listApprovedMaterials: typeof import("./store.ts").listApprovedMaterials;
let listModules: typeof import("./store.ts").listModules;
let regenerateBlakeTrainerFromSystemKnowledge: typeof import("./store.ts").regenerateBlakeTrainerFromSystemKnowledge;
let startOrResumeProgress: typeof import("./store.ts").startOrResumeProgress;
let runBlakeTrainerTurn: typeof import("./tutor.ts").runBlakeTrainerTurn;
let generateBlakeTrainerCatalog: typeof import("./system-knowledge.ts").generateBlakeTrainerCatalog;

before(async () => {
  const store = await import("./store.ts");
  const tutor = await import("./tutor.ts");
  const knowledge = await import("./system-knowledge.ts");
  ({
    resetBlakeTrainerStoreForTests,
    listFlows,
    listApprovedMaterials,
    listModules,
    regenerateBlakeTrainerFromSystemKnowledge,
    startOrResumeProgress,
  } = store);
  ({ runBlakeTrainerTurn } = tutor);
  ({ generateBlakeTrainerCatalog } = knowledge);
  resetBlakeTrainerStoreForTests();
});

test("Blake generates a full system catalog covering Core, Field and specialist tools", () => {
  const catalog = generateBlakeTrainerCatalog();
  assert.ok(catalog.materials.length >= 15);
  assert.ok(catalog.modules.some((mod) => mod.id === "mod-field-complete"));
  assert.ok(catalog.modules.some((mod) => mod.id === "mod-core-commercial"));
  assert.ok(catalog.flows.some((flow) => flow.id === "flow-manager-full"));
  assert.ok(catalog.materials.every((item) => item.approved));
});

test("seed publishes role-aware engineer and office flows", () => {
  resetBlakeTrainerStoreForTests();
  const engineerFlows = listFlows({ status: "published", role: "Engineer" });
  assert.ok(engineerFlows.some((flow) => flow.id === "flow-engineer-full"));
  assert.ok(!engineerFlows.some((flow) => flow.id === "flow-office-full"));

  const officeFlows = listFlows({ status: "published", role: "Office" });
  assert.ok(officeFlows.some((flow) => flow.id === "flow-office-full"));
});

test("only approved materials are listed for grounding", () => {
  resetBlakeTrainerStoreForTests();
  const materials = listApprovedMaterials("Engineer");
  assert.ok(materials.length >= 5);
  assert.ok(materials.every((item) => item.approved));
  assert.ok(materials.every((item) => item.roles.includes("Engineer")));
});

test("regenerate replaces system modules while keeping custom materials", () => {
  resetBlakeTrainerStoreForTests();
  const before = listModules().length;
  const summary = regenerateBlakeTrainerFromSystemKnowledge("Brian Kerr");
  assert.equal(summary.modules, before);
  assert.ok(summary.materials >= 15);
  assert.ok(listFlows({ status: "published" }).length >= 3);
});

test("Blake refuses questions outside the approved pack", async () => {
  resetBlakeTrainerStoreForTests();
  const turn = await runBlakeTrainerTurn({
    flowId: "flow-engineer-full",
    userId: "eng-1",
    userName: "Sam Engineer",
    role: "Engineer",
    mode: "question",
    message: "What is the secret discount code for Xero invoices in 2099?",
    voice: true,
  });
  assert.equal(turn.refused, true);
  assert.equal(turn.grounded, false);
  assert.match(turn.reply.toLowerCase(), /approved|won't guess|will not guess|don't have|do not have/);
});

test("Blake teaches from approved materials and tracks completion through a check", async () => {
  resetBlakeTrainerStoreForTests();
  const start = await runBlakeTrainerTurn({
    flowId: "flow-engineer-full",
    userId: "eng-2",
    userName: "Alex Engineer",
    role: "Engineer",
    mode: "start",
    voice: true,
  });
  assert.equal(start.phase, "teach");
  assert.ok(start.citations.length > 0);
  assert.equal(start.progress.status, "in_progress");

  let progressId = start.progress.id;
  for (let i = 0; i < 12; i += 1) {
    const turn = await runBlakeTrainerTurn({
      flowId: "flow-engineer-full",
      progressId,
      userId: "eng-2",
      userName: "Alex Engineer",
      role: "Engineer",
      mode: "continue",
      message: "next",
      voice: true,
    });
    progressId = turn.progress.id;
    if (turn.phase === "check") {
      const check = await runBlakeTrainerTurn({
        flowId: "flow-engineer-full",
        progressId,
        userId: "eng-2",
        userName: "Alex Engineer",
        role: "Engineer",
        mode: "check_answer",
        message:
          "Blake is the command center for quotes and jobs. If it’s not in approved materials Blake must not guess and I should ask Brian.",
        voice: true,
      });
      assert.equal(check.checkResult?.passed, true);
      break;
    }
    if (turn.phase === "complete") break;
  }

  const resumed = startOrResumeProgress({
    flowId: "flow-engineer-full",
    userId: "eng-2",
    userName: "Alex Engineer",
    role: "Engineer",
  });
  assert.ok(resumed.modules.some((mod) => mod.steps.some((step) => step.completed)));
});

test("grounded local answer cites Field Hours material", async () => {
  resetBlakeTrainerStoreForTests();
  const start = await runBlakeTrainerTurn({
    flowId: "flow-engineer-full",
    userId: "eng-3",
    userName: "Jo",
    role: "Engineer",
    mode: "start",
  });

  const ask = await runBlakeTrainerTurn({
    flowId: "flow-engineer-full",
    progressId: start.progress.id,
    userId: "eng-3",
    userName: "Jo",
    role: "Engineer",
    mode: "question",
    message: "What do I do in Hours at the end of the day?",
  });
  assert.equal(ask.refused, false);
  assert.equal(ask.grounded, true);
  assert.ok(ask.citations.some((item) => /hours|time/i.test(item.title)));
});
