import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function dynamicShape(segment: string) {
  if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) return "optional-catch-all";
  if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return "catch-all";
  if (/^\[[^\]]+\]$/.test(segment)) return "dynamic";
  return null;
}

function findConflicts(directory: string, relative = "src/app"): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const byShape = new Map<string, string[]>();

  for (const entry of entries) {
    const shape = dynamicShape(entry.name);
    if (!shape) continue;
    const siblings = byShape.get(shape) ?? [];
    siblings.push(entry.name);
    byShape.set(shape, siblings);
  }

  const conflicts = [...byShape.entries()]
    .filter(([, siblings]) => new Set(siblings).size > 1)
    .map(([shape, siblings]) => `${relative}: ${shape} siblings ${siblings.join(", ")}`);

  for (const entry of entries) {
    conflicts.push(...findConflicts(path.join(directory, entry.name), path.join(relative, entry.name)));
  }
  return conflicts;
}

test("Next app routes do not use different slug names for the same dynamic sibling path", () => {
  const appDirectory = path.join(process.cwd(), "src", "app");
  const conflicts = findConflicts(appDirectory);
  assert.deepEqual(
    conflicts,
    [],
    `Conflicting Next.js dynamic route slugs found:\n${conflicts.join("\n")}`,
  );
});
