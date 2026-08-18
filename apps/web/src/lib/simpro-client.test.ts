import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { simproEntityDetailPaths, withSimproCompany } from "@/lib/simpro-client";
import type { ResolvedSimproDirectConfig } from "@/lib/simpro-auth";

describe("simpro client detail paths", () => {
  it("prefers OpenAPI-style paths without a trailing slash", () => {
    const paths = simproEntityDetailPaths("quotes", "2217");
    assert.equal(paths[0], "/quotes/2217?display=all");
    assert.equal(paths[1], "/quotes/2217");
    assert.ok(paths.includes("/quotes/2217/?display=all"));
    assert.ok(paths.includes("/quotes/2217/"));
  });

  it("overrides company id for multi-company detail retries", () => {
    const config = {
      baseUrl: "https://example.simprosuite.com/api/v1.0",
      companyId: "0",
      token: "token",
    } as ResolvedSimproDirectConfig;
    const next = withSimproCompany(config, "2");
    assert.equal(next.companyId, "2");
    assert.equal(next.baseUrl, config.baseUrl);
    assert.equal(withSimproCompany(config, "0"), config);
  });

  it("never falls back to an unrelated list row when quote ID is missing from the page", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const clientSource = readFileSync(join(dir, "simpro-client.ts"), "utf8");
    assert.match(clientSource, /never take records\[0\]/);
    assert.doesNotMatch(
      clientSource.slice(
        clientSource.indexOf("Last resort: list filter"),
        clientSource.indexOf("export function simproCustomerDetailPaths"),
      ),
      /extractSimproRecords\(listed\.body\)\[0\]/,
    );
    assert.match(clientSource, /simproGetCustomerDetail/);

    const deepSource = readFileSync(join(dir, "simpro-deep-import.ts"), "utf8");
    assert.match(deepSource, /detail ID mismatch/);
    assert.match(deepSource, /sections\/ still works/);
  });
});
