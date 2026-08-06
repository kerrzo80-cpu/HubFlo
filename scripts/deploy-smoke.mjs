#!/usr/bin/env node
/**
 * Post-deploy / uptime smoke — fetch only, no browser.
 *
 * Usage:
 *   NEXA_SMOKE_BASE_URL=https://nexa-live.onrender.com node scripts/deploy-smoke.mjs
 *   node scripts/deploy-smoke.mjs --base https://nexa-live.onrender.com --hold-seconds 120
 *
 * Exit 0 = all checks passed (and hold window stayed green if requested).
 */
const args = process.argv.slice(2);
function flag(name, fallback = "") {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const baseUrl = (flag("--base", process.env.NEXA_SMOKE_BASE_URL || "https://nexa-live.onrender.com")).replace(
  /\/$/,
  "",
);
const holdSeconds = Number(flag("--hold-seconds", process.env.NEXA_SMOKE_HOLD_SECONDS || "0")) || 0;
const timeoutMs = Number(flag("--timeout-ms", process.env.NEXA_SMOKE_TIMEOUT_MS || "20000")) || 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probe(path, { expectStatus, expectRedirectTo, expectBodyIncludes, expectJson } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "text/html,application/json,*/*" },
    });
    const elapsedMs = Date.now() - started;
    const status = response.status;
    const location = response.headers.get("location") || "";
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not json
    }

    if (Array.isArray(expectStatus) && !expectStatus.includes(status)) {
      throw new Error(`${path} status ${status}, expected one of ${expectStatus.join(",")}`);
    }
    if (typeof expectStatus === "number" && status !== expectStatus) {
      throw new Error(`${path} status ${status}, expected ${expectStatus}`);
    }
    if (expectRedirectTo && !location.includes(expectRedirectTo)) {
      throw new Error(`${path} redirect "${location}" missing "${expectRedirectTo}"`);
    }
    if (expectBodyIncludes && !text.includes(expectBodyIncludes)) {
      throw new Error(`${path} body missing "${expectBodyIncludes}"`);
    }
    if (expectJson) {
      expectJson(json);
    }

    return { path, status, elapsedMs, location, ok: true };
  } finally {
    clearTimeout(timer);
  }
}

async function runOnce() {
  const results = [];

  results.push(
    await probe("/api/health", {
      expectStatus: 200,
      expectJson: (json) => {
        if (!json?.ok) throw new Error("/api/health ok !== true");
        if (!json?.deployment?.commit) throw new Error("/api/health missing deployment.commit");
        if (!json?.deployment?.tenOfTenPlan) throw new Error("/api/health missing tenOfTenPlan");
        if (json?.deployment?.coreRoutes !== "url-modules-v1") {
          throw new Error(`/api/health coreRoutes=${json?.deployment?.coreRoutes}, expected url-modules-v1`);
        }
        if (json?.deployment?.fieldPhotoSync !== "bytes-v1") {
          throw new Error(
            `/api/health fieldPhotoSync=${json?.deployment?.fieldPhotoSync}, expected bytes-v1`,
          );
        }
      },
    }),
  );

  results.push(
    await probe("/login", {
      expectStatus: 200,
      expectBodyIncludes: "Sign in",
    }),
  );

  // Unauthenticated Core should bounce to login (users auth mode).
  results.push(
    await probe("/", {
      expectStatus: [307, 302, 200],
    }),
  );

  // Core module URL routes (Phase 1 route split) — must resolve, not 404.
  for (const path of ["/jobs", "/quotes", "/leads", "/setup", "/reports", "/people", "/schedule", "/invoices"]) {
    results.push(
      await probe(path, {
        expectStatus: [307, 302, 200],
      }),
    );
  }

  results.push(
    await probe("/field", {
      expectStatus: [307, 302, 200],
    }),
  );

  results.push(await probe("/sw-field.js", { expectStatus: 200 }));
  results.push(await probe("/field/sw.js", { expectStatus: 200 }));
  results.push(await probe("/api/manifest/field", { expectStatus: 200 }));
  results.push(await probe("/heat-design", { expectStatus: 200 }));
  results.push(await probe("/api/branding", { expectStatus: 200 }));

  return results;
}

async function main() {
  console.log(JSON.stringify({ baseUrl, holdSeconds, timeoutMs }, null, 2));
  const started = Date.now();
  let pass = 0;

  while (true) {
    const results = await runOnce();
    pass += 1;
    const summary = {
      pass,
      elapsedSec: Math.round((Date.now() - started) / 1000),
      results: results.map((row) => ({
        path: row.path,
        status: row.status,
        ms: row.elapsedMs,
        location: row.location || undefined,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));

    if (holdSeconds <= 0) break;
    if (Date.now() - started >= holdSeconds * 1000) break;
    await sleep(15000);
  }

  console.log(JSON.stringify({ ok: true, baseUrl, passes: pass }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
