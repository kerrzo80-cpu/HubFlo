import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

type RouteRecord = {
  file: string;
  segments: string[];
};

function dynamicShape(segment: string) {
  if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) return "optional-catch-all";
  if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return "catch-all";
  if (/^\[[^\]]+\]$/.test(segment)) return "dynamic";
  return null;
}

function isRouteGroup(segment: string) {
  return /^\([^()]+\)$/.test(segment);
}

function isParallelRoute(segment: string) {
  return segment.startsWith("@");
}

function collectRoutes(directory: string, physicalSegments: string[] = []): RouteRecord[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const routes: RouteRecord[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      routes.push(...collectRoutes(path.join(directory, entry.name), [...physicalSegments, entry.name]));
      continue;
    }
    if (!entry.isFile() || (entry.name !== "page.tsx" && entry.name !== "route.ts")) continue;
    routes.push({
      file: path.join(...physicalSegments, entry.name),
      segments: physicalSegments.filter((segment) => !isRouteGroup(segment) && !isParallelRoute(segment)),
    });
  }

  return routes;
}

function findDynamicSlugConflicts(routes: RouteRecord[]) {
  const namesByPublicPrefix = new Map<string, Map<string, Set<string>>>();

  for (const route of routes) {
    const normalized: string[] = [];
    for (const segment of route.segments) {
      const shape = dynamicShape(segment);
      normalized.push(shape ? `<${shape}>` : segment);
      if (!shape) continue;

      const prefix = `/${normalized.join("/")}`;
      const namesByFile = namesByPublicPrefix.get(prefix) ?? new Map<string, Set<string>>();
      const files = namesByFile.get(segment) ?? new Set<string>();
      files.add(route.file);
      namesByFile.set(segment, files);
      namesByPublicPrefix.set(prefix, namesByFile);
    }
  }

  return [...namesByPublicPrefix.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([prefix, names]) => {
      const details = [...names.entries()]
        .map(([name, files]) => `${name} in ${[...files].join(", ")}`)
        .join(" | ");
      return `${prefix}: ${details}`;
    });
}

test("Next app routes use one slug name for each public dynamic path", () => {
  const appDirectory = path.join(process.cwd(), "src", "app");
  const routes = collectRoutes(appDirectory);
  const conflicts = findDynamicSlugConflicts(routes);
  assert.deepEqual(
    conflicts,
    [],
    `Conflicting Next.js dynamic route slugs found:\n${conflicts.join("\n")}`,
  );
});
