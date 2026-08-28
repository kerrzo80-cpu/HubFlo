import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const core = readFileSync(join(process.cwd(), "src/app/CoreApp.tsx"), "utf8");
const passaround = readFileSync(join(process.cwd(), "src/lib/job-passaround.ts"), "utf8");

describe("Ready-to-invoice passaround hold", () => {
  it("skips office boot poll while passaround hold is armed", () => {
    assert.match(core, /passaround_hold/);
    assert.match(core, /Date\.now\(\) < passaroundHoldUntilRef\.current/);
    assert.match(core, /Do not retry while passaround is holding/);
  });

  it("marks Ready optimistically before awaiting the passaround API", () => {
    const fn = core.slice(core.indexOf("async function approveSelectedJobForInvoice"));
    const body = fn.slice(0, fn.indexOf("async function closeSelectedJobToCompleteFolder"));
    assert.match(body, /Optimistic UI first/);
    assert.match(body, /status: "Ready to invoice"/);
    const optimisticIdx = body.indexOf("Optimistic UI first");
    const awaitIdx = body.indexOf("await postJobPassaround");
    assert.ok(optimisticIdx >= 0 && awaitIdx > optimisticIdx);
  });

  it("does not POST /api/audit on Chris/Commercial/Carol tick hot path", () => {
    const fn = core.slice(core.indexOf("function toggleSelectedJobReview"));
    const body = fn.slice(0, fn.indexOf("async function approveSelectedJobForInvoice"));
    assert.match(body, /Local timeline only/);
    assert.doesNotMatch(body, /logAuditEvent\(/);
  });

  it("readyJobForInvoice avoids a second getJob confirmation read", () => {
    const fn = passaround.slice(passaround.indexOf("export function readyJobForInvoice"));
    assert.match(fn, /never re-read the workflow store here/);
    const codeOnly = fn.replace(/\/\/.*$/gm, "");
    assert.equal((codeOnly.match(/getJob\(/g) || []).length, 1);
  });
});
