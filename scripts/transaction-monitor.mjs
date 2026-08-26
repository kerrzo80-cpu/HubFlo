#!/usr/bin/env node

const base = (process.env.NEXA_MONITOR_BASE_URL || "https://nexa-pilot.onrender.com").replace(/\/$/, "");
const timeoutMs = Number(process.env.NEXA_MONITOR_TIMEOUT_MS || 15000);
const maxMs = Number(process.env.NEXA_MONITOR_MAX_MS || 5000);
const paths = ["/api/health", "/login", "/jobs", "/leads", "/quotes", "/schedule", "/invoices", "/field"];
const results = [];

for (const path of paths) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${base}${path}`, { redirect: "manual", signal: controller.signal, cache: "no-store" });
    const elapsedMs = Date.now() - started;
    const validStatus = [200, 302, 307, 308].includes(response.status);
    results.push({ path, status: response.status, elapsedMs, ok: validStatus && elapsedMs <= maxMs });
  } catch (error) {
    results.push({ path, status: 0, elapsedMs: Date.now() - started, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
}

console.log(JSON.stringify({ base, checkedAt: new Date().toISOString(), results }, null, 2));
if (results.some((row) => !row.ok)) process.exit(1);
