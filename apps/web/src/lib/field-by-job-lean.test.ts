import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("field by-job lean open path", () => {
  it("by-job route uses peek and never getEngineerSchedule/getHubDetailState", () => {
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/field/jobs/by-job/[jobId]/route.ts"),
      "utf8",
    );
    assert.match(route, /peekHubDetailState/);
    assert.doesNotMatch(route, /\bgetEngineerSchedule\s*\(/);
    assert.doesNotMatch(route, /\bgetHubDetailState\s*\(/);
    assert.doesNotMatch(route, /\bgetEngineerJobWorkflow\s*\(/);
  });

  it("JobFieldLivePanel does not auto-fetch on mount", () => {
    const panel = readFileSync(path.join(process.cwd(), "src/components/JobFieldLivePanel.tsx"), "utf8");
    assert.match(panel, /Load Field evidence/);
    assert.doesNotMatch(panel, /useEffect\(\(\) => \{\s*void load\(\);/);
  });

  it("openJobDrawer does not heal cost centres on open", () => {
    const core = readFileSync(path.join(process.cwd(), "src/app/CoreApp.tsx"), "utf8");
    const start = core.indexOf("function openJobDrawer(jobId: string)");
    assert.ok(start > 0);
    const brace = core.indexOf("{", start);
    let depth = 0;
    let end = brace;
    for (let i = brace; i < core.length; i += 1) {
      if (core[i] === "{") depth += 1;
      else if (core[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const body = core.slice(start, end);
    assert.doesNotMatch(body, /healSelectedJobCostCentresIfNeeded/);
  });
});
