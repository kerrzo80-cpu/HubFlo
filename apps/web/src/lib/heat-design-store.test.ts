import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const storeDir = path.join(tmpdir(), `hubflo-heat-design-store-${process.pid}-${Date.now()}`);
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";

let createHeatDesignProject: typeof import("./heat-design-store").createHeatDesignProject;
let deleteHeatDesignProject: typeof import("./heat-design-store").deleteHeatDesignProject;
let getHeatDesignProject: typeof import("./heat-design-store").getHeatDesignProject;
let listHeatDesignProjects: typeof import("./heat-design-store").listHeatDesignProjects;
let listHeatDesignRevisions: typeof import("./heat-design-store").listHeatDesignRevisions;
let resetHeatDesignStoreForTests: typeof import("./heat-design-store").resetHeatDesignStoreForTests;
let saveHeatDesignProject: typeof import("./heat-design-store").saveHeatDesignProject;

before(async () => {
  const mod = await import("./heat-design-store");
  ({
    createHeatDesignProject,
    deleteHeatDesignProject,
    getHeatDesignProject,
    listHeatDesignProjects,
    listHeatDesignRevisions,
    resetHeatDesignStoreForTests,
    saveHeatDesignProject,
  } = mod);
  resetHeatDesignStoreForTests();
});

after(() => {
  rmSync(storeDir, { force: true, recursive: true });
});

test("create/save/list/delete heat design projects", () => {
  const created = createHeatDesignProject({ name: "Server design", customerName: "EWG" });

  assert.match(created.id, /^hd-project-/);
  assert.equal(created.name, "Server design");
  assert.equal(created.customerName, "EWG");
  assert.equal(created.rooms.length, 0);
  assert.ok(created.updatedAt);
  assert.deepEqual(listHeatDesignProjects().map((item) => item.id), [created.id]);

  const saved = saveHeatDesignProject({
    ...created,
    name: "Renamed server design",
    updatedAt: "2026-08-06T16:00:00.000Z",
  });

  assert.equal(saved.id, created.id);
  assert.equal(getHeatDesignProject(created.id)?.name, "Renamed server design");
  assert.deepEqual(listHeatDesignProjects().map((item) => item.name), ["Renamed server design"]);

  assert.equal(deleteHeatDesignProject(created.id), true);
  assert.equal(getHeatDesignProject(created.id), undefined);
  assert.deepEqual(listHeatDesignProjects(), []);
});

test("save appends heat design revisions", () => {
  resetHeatDesignStoreForTests();
  const created = createHeatDesignProject({ name: "Audit design" });

  const firstSave = saveHeatDesignProject({ ...created, customerName: "First customer" });
  const secondSave = saveHeatDesignProject({ ...firstSave, customerName: "Second customer" });
  const revisions = listHeatDesignRevisions(created.id);

  assert.equal(firstSave.revisions?.length, 1);
  assert.equal(secondSave.revisions?.length, 2);
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0].id, secondSave.revisions?.[0]?.id);
  assert.match(revisions[0].summary, /^Saved 0 rooms · 0 W heat loss$/);
  assert.ok(revisions[0].snapshotHash);
});
