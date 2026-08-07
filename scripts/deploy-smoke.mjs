#!/usr/bin/env node
/**
 * Post-deploy / uptime smoke — fetch only, no browser.
 *
 * Retries through Render deploy 502/503 windows so a mid-deploy probe does not
 * page the team. Only exits 1 after sustained failure.
 *
 * Usage:
 *   NEXA_SMOKE_BASE_URL=https://nexa-live.onrender.com node scripts/deploy-smoke.mjs
 *   node scripts/deploy-smoke.mjs --base https://nexa-live.onrender.com --hold-seconds 120
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
const timeoutMs = Number(flag("--timeout-ms", process.env.NEXA_SMOKE_TIMEOUT_MS || "25000")) || 25000;
const settleSeconds =
  Number(flag("--settle-seconds", process.env.NEXA_SMOKE_SETTLE_SECONDS || "480")) || 480;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status) {
  return status === 502 || status === 503 || status === 504 || status === 520 || status === 522 || status === 524;
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
      cache: "no-store",
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

    if (isTransientStatus(status)) {
      const err = new Error(`${path} status ${status} (deploy/transient)`);
      err.transient = true;
      throw err;
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
  } catch (error) {
    if (error?.name === "AbortError") {
      const err = new Error(`${path} timed out after ${timeoutMs}ms`);
      err.transient = true;
      throw err;
    }
    if (error && typeof error === "object" && !("transient" in error)) {
      const message = error instanceof Error ? error.message : String(error);
      if (/fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
        const err = new Error(message);
        err.transient = true;
        throw err;
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertHealth(json) {
  if (!json?.ok) throw new Error("/api/health ok !== true");
  if (!json?.deployment?.commit) throw new Error("/api/health missing deployment.commit");
  // Soft flags: warn via throw only if missing after settle; required spine markers.
  if (!json?.deployment?.tenOfTenPlan) throw new Error("/api/health missing tenOfTenPlan");
  if (json?.deployment?.coreRoutes !== "url-modules-v1") {
    throw new Error(`/api/health coreRoutes=${json?.deployment?.coreRoutes}, expected url-modules-v1`);
  }
}

async function runOnce() {
  const results = [];

  results.push(
    await probe("/api/health", {
      expectStatus: 200,
      expectJson: assertHealth,
    }),
  );

  results.push(
    await probe("/login", {
      expectStatus: 200,
      expectBodyIncludes: "Sign in",
    }),
  );

  results.push(
    await probe("/", {
      expectStatus: [307, 302, 200],
    }),
  );

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

async function runOnceWithSettle() {
  const deadline = Date.now() + settleSeconds * 1000;
  let attempt = 0;
  let lastError = null;

  while (Date.now() <= deadline) {
    attempt += 1;
    try {
      const results = await runOnce();
      return { results, attempt };
    } catch (error) {
      lastError = error;
      const transient = Boolean(error && typeof error === "object" && error.transient);
      const message = error instanceof Error ? error.message : String(error);
      const remainingMs = deadline - Date.now();
      console.error(
        JSON.stringify({
          attempt,
          transient,
          remainingSec: Math.max(0, Math.round(remainingMs / 1000)),
          error: message,
        }),
      );
      if (!transient && attempt >= 2) throw error;
      if (remainingMs <= 0) break;
      await sleep(Math.min(20000, Math.max(5000, Math.floor(remainingMs / 6))));
    }
  }

  throw lastError || new Error("Smoke failed after settle window");
}

async function main() {
  console.log(JSON.stringify({ baseUrl, holdSeconds, timeoutMs, settleSeconds }, null, 2));
  const started = Date.now();
  let pass = 0;

  while (true) {
    const { results, attempt } = await runOnceWithSettle();
    pass += 1;
    const summary = {
      pass,
      attempt,
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
